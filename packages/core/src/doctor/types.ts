export type DoctorCheck = {
  scope: "repo" | "bootstrap" | "server-deploy" | "cattle";
  status: "ok" | "warn" | "missing";
  label: string;
  detail?: string;
};

export type DoctorPush = (c: DoctorCheck) => void;
