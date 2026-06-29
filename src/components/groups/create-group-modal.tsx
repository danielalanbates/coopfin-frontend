"use client";

import { useState, useMemo, useCallback } from "react";
import {
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  nativeToScVal,
  SorobanRpc,
  xdr,
} from "@stellar/stellar-sdk";
import { useWallet } from "@/hooks/use-wallet";
import {
  server,
  networkPassphrase,
  CONTRACT_IDS,
  parseAmount,
  shortenAddress,
} from "@/lib/stellar";

type Frequency = "weekly" | "monthly" | "custom";

type Step = "form" | "confirm" | "deploying" | "success" | "error";

type DeployStage =
  | "idle"
  | "treasury"
  | "loan"
  | "voting"
  | "register"
  | "done";

interface FormState {
  name: string;
  description: string;
  minContribution: string;
  frequency: Frequency;
  customDays: string;
}

interface FormErrors {
  name?: string;
  description?: string;
  minContribution?: string;
  customDays?: string;
}

interface DeployedContracts {
  treasury: string;
  loan: string;
  voting: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function frequencyToDays(freq: Frequency, customDays: string): number {
  if (freq === "weekly") return 7;
  if (freq === "monthly") return 30;
  return Math.max(1, Math.floor(Number(customDays) || 0));
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const name = form.name.trim();
  if (name.length < 3 || name.length > 50) {
    errors.name = "Name must be 3–50 characters";
  }
  if (form.description.length > 200) {
    errors.description = "Description must be 200 characters or fewer";
  }
  const amount = Number(form.minContribution);
  if (!form.minContribution || Number.isNaN(amount) || amount <= 0) {
    errors.minContribution = "Enter a number greater than 0";
  }
  if (form.frequency === "custom") {
    const days = Number(form.customDays);
    if (!form.customDays || Number.isNaN(days) || days < 1) {
      errors.customDays = "Enter the number of days (minimum 1)";
    }
  }
  return errors;
}

/**
 * Build, simulate, sign and submit a Soroban contract invocation.
 * Returns the contract ID on success. Throws on any failure (sim error,
 * user rejection, submission error, non-SUCCESS final status).
 *
 * Note: On testnet the Treasury / Loan / Voting contracts are pre-deployed
 * (see deployments/testnet.json + NEXT_PUBLIC_*_CONTRACT_ID env vars).
 * Group creation calls `initialize` per group with a unique admin + ruleset
 * — this matches the pattern used by the coopfin-contracts repo.
 */
async function invokeInitialize(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
  signTransaction: (txXdr: string) => Promise<string>
): Promise<string> {
  if (!contractId) {
    throw new Error(
      `Missing contract ID for ${method}. Check NEXT_PUBLIC_*_CONTRACT_ID env vars.`
    );
  }

  const account = await server.getAccount(sourceAddress);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${sim.error}`);
  }
  const assembled = SorobanRpc.assembleTransaction(tx, sim).build();

  const signedXdr = await signTransaction(assembled.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  const sendResp = await server.sendTransaction(signedTx);
  if (sendResp.status === "ERROR") {
    throw new Error(
      `Transaction submission failed: ${
        sendResp.errorResult?.result().switch().name ?? "unknown"
      }`
    );
  }

  // Poll until settled (~30s max).
  let status = await server.getTransaction(sendResp.hash);
  const start = Date.now();
  while (status.status === "NOT_FOUND" && Date.now() - start < 30_000) {
    await new Promise((r) => setTimeout(r, 1500));
    status = await server.getTransaction(sendResp.hash);
  }
  if (status.status !== "SUCCESS") {
    throw new Error(
      `Transaction ${sendResp.hash} did not succeed: ${status.status}`
    );
  }

  return contractId;
}

export function CreateGroupModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated?: (groupId: string) => void;
}) {
  const { address, isConnecting, connect, signTransaction } = useWallet();

  const [step, setStep] = useState<Step>("form");
  const [stage, setStage] = useState<DeployStage>("idle");
  const [form, setForm] = useState<FormState>({
    name: "",
    description: "",
    minContribution: "",
    frequency: "monthly",
    customDays: "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [deployed, setDeployed] = useState<DeployedContracts | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  const isValid = useMemo(
    () => Object.keys(validate(form)).length === 0,
    [form]
  );

  const update = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
    },
    []
  );

  const handleNext = () => {
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length === 0) {
      setStep("confirm");
    }
  };

  const handleDeploy = async () => {
    if (!address) return;
    setStep("deploying");
    setDeployError(null);
    setStage("treasury");

    try {
      const minContributionStroops = parseAmount(form.minContribution);
      const periodDays = frequencyToDays(form.frequency, form.customDays);
      const adminScVal = new Address(address).toScVal();

      // Step 1 — Treasury
      const treasury = await invokeInitialize(
        CONTRACT_IDS.treasury,
        "initialize",
        [
          adminScVal,
          nativeToScVal(minContributionStroops, { type: "i128" }),
          nativeToScVal(periodDays, { type: "u32" }),
        ],
        address,
        signTransaction
      );

      // Step 2 — Loan
      setStage("loan");
      const loan = await invokeInitialize(
        CONTRACT_IDS.loan,
        "initialize",
        [adminScVal, new Address(treasury).toScVal()],
        address,
        signTransaction
      );

      // Step 3 — Voting
      setStage("voting");
      const voting = await invokeInitialize(
        CONTRACT_IDS.voting,
        "initialize",
        [adminScVal, new Address(treasury).toScVal()],
        address,
        signTransaction
      );

      setDeployed({ treasury, loan, voting });

      // Step 4 — Register with API
      setStage("register");
      const resp = await fetch(`${API_URL}/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim(),
          admin: address,
          rules: {
            minContribution: Number(form.minContribution),
            contributionPeriodDays: periodDays,
          },
          contractAddresses: {
            treasury,
            loan,
            voting,
          },
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => resp.statusText);
        throw new Error(`API registration failed (${resp.status}): ${text}`);
      }
      const json = (await resp.json()) as { id?: string; groupId?: string };
      const id = json.id ?? json.groupId ?? treasury;
      setGroupId(id);
      setStage("done");
      setStep("success");
      onCreated?.(id);
    } catch (err: unknown) {
      setDeployError(err instanceof Error ? err.message : "Deployment failed");
      setStep("error");
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Create New Group</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        </div>

        {step === "form" && (
          <FormStep
            form={form}
            errors={errors}
            update={update}
            onCancel={onClose}
            onNext={handleNext}
            isValid={isValid}
          />
        )}

        {step === "confirm" && (
          <ConfirmStep
            form={form}
            address={address}
            isConnecting={isConnecting}
            onBack={() => setStep("form")}
            onConnect={connect}
            onDeploy={handleDeploy}
          />
        )}

        {step === "deploying" && <DeployingStep stage={stage} />}

        {step === "success" && deployed && groupId && (
          <SuccessStep
            groupId={groupId}
            deployed={deployed}
            onClose={onClose}
          />
        )}

        {step === "error" && (
          <ErrorStep
            message={deployError ?? "Unknown error"}
            onRetry={() => setStep("confirm")}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- Sub-steps ---------- */

function FormStep({
  form,
  errors,
  update,
  onCancel,
  onNext,
  isValid,
}: {
  form: FormState;
  errors: FormErrors;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  onCancel: () => void;
  onNext: () => void;
  isValid: boolean;
}) {
  return (
    <div className="space-y-4">
      <Field label="Group Name" error={errors.name} required>
        <input
          type="text"
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          maxLength={50}
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="Neighborhood Savings Circle"
        />
      </Field>

      <Field label="Description" error={errors.description}>
        <textarea
          value={form.description}
          onChange={(e) => update("description", e.target.value)}
          maxLength={200}
          rows={3}
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="What is this group for? (optional)"
        />
        <p className="text-xs text-gray-400 mt-1">
          {form.description.length}/200
        </p>
      </Field>

      <Field
        label="Minimum Contribution (USDC)"
        error={errors.minContribution}
        required
      >
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.minContribution}
          onChange={(e) => update("minContribution", e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm"
          placeholder="50.00"
        />
      </Field>

      <Field label="Contribution Frequency" required>
        <select
          value={form.frequency}
          onChange={(e) => update("frequency", e.target.value as Frequency)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="custom">Custom</option>
        </select>
      </Field>

      {form.frequency === "custom" && (
        <Field label="Custom period (days)" error={errors.customDays} required>
          <input
            type="number"
            min="1"
            value={form.customDays}
            onChange={(e) => update("customDays", e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm"
            placeholder="14"
          />
        </Field>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
        >
          Cancel
        </button>
        <button
          onClick={onNext}
          disabled={!isValid}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function ConfirmStep({
  form,
  address,
  isConnecting,
  onBack,
  onConnect,
  onDeploy,
}: {
  form: FormState;
  address: string | null;
  isConnecting: boolean;
  onBack: () => void;
  onConnect: () => void;
  onDeploy: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-gray-50 p-4 text-sm space-y-1">
        <div>
          <span className="text-gray-500">Name:</span>{" "}
          <span className="font-medium">{form.name}</span>
        </div>
        {form.description && (
          <div>
            <span className="text-gray-500">Description:</span>{" "}
            {form.description}
          </div>
        )}
        <div>
          <span className="text-gray-500">Min contribution:</span>{" "}
          <span className="font-medium">{form.minContribution} USDC</span>
        </div>
        <div>
          <span className="text-gray-500">Frequency:</span>{" "}
          <span className="font-medium capitalize">
            {form.frequency}
            {form.frequency === "custom" && ` (${form.customDays} days)`}
          </span>
        </div>
      </div>

      <p className="text-xs text-gray-500">
        This will sign 3 Soroban transactions on Stellar testnet to initialize
        the Treasury, Loan, and Voting contracts for your group.
      </p>

      {!address ? (
        <button
          onClick={onConnect}
          disabled={isConnecting}
          className="w-full px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {isConnecting ? "Connecting…" : "Connect Wallet"}
        </button>
      ) : (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          Connected: {shortenAddress(address)}
        </div>
      )}

      <div className="flex gap-2 justify-end pt-2">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
        >
          Back
        </button>
        <button
          onClick={onDeploy}
          disabled={!address}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Deploy Contracts
        </button>
      </div>
    </div>
  );
}

function DeployingStep({ stage }: { stage: DeployStage }) {
  const steps: { key: DeployStage; label: string }[] = [
    { key: "treasury", label: "Deploying Treasury…" },
    { key: "loan", label: "Deploying Loan Contract…" },
    { key: "voting", label: "Deploying Voting…" },
    { key: "register", label: "Registering with API…" },
    { key: "done", label: "Complete" },
  ];

  const order: DeployStage[] = [
    "treasury",
    "loan",
    "voting",
    "register",
    "done",
  ];
  const currentIdx = order.indexOf(stage);

  return (
    <ul className="space-y-3 py-4">
      {steps.map((s, i) => {
        const isDone = i < currentIdx;
        const isActive = i === currentIdx;
        return (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span
              className={
                "flex h-6 w-6 items-center justify-center rounded-full border " +
                (isDone
                  ? "bg-green-500 border-green-500 text-white"
                  : isActive
                  ? "border-brand-600 text-brand-600 animate-pulse"
                  : "border-gray-300 text-gray-400")
              }
            >
              {isDone ? "✓" : i + 1}
            </span>
            <span
              className={
                isDone
                  ? "text-gray-700"
                  : isActive
                  ? "text-gray-900 font-medium"
                  : "text-gray-400"
              }
            >
              {s.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SuccessStep({
  groupId,
  deployed,
  onClose,
}: {
  groupId: string;
  deployed: DeployedContracts;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm">
        <p className="font-semibold text-green-800 mb-2">Group created! 🎉</p>
        <div className="space-y-1 text-xs text-green-900 font-mono break-all">
          <div>
            <span className="text-green-700">Group ID:</span> {groupId}
          </div>
          <div>
            <span className="text-green-700">Treasury:</span> {deployed.treasury}
          </div>
          <div>
            <span className="text-green-700">Loan:</span> {deployed.loan}
          </div>
          <div>
            <span className="text-green-700">Voting:</span> {deployed.voting}
          </div>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function ErrorStep({
  message,
  onRetry,
  onClose,
}: {
  message: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-semibold mb-1">Something went wrong</p>
        <p className="text-xs break-words">{message}</p>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
        >
          Close
        </button>
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  error,
  required,
  children,
}: {
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-700 mb-1">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </label>
  );
}
