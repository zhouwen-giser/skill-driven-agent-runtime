export const root: string;
export const defaults: Readonly<Record<string, string>>;
export function readConfiguration(
  envPath: string,
  overrides?: Readonly<Record<string, string>>,
  inherited?: NodeJS.ProcessEnv,
): Record<string, string>;
export function initialize(envPath: string): {
  status: 'preserved' | 'initialized';
  envPath: string;
  model?: string;
  provider?: string;
};
export function validateConfiguration(configuration: Readonly<Record<string, string>>): void;
export function redactedConfiguration(
  configuration: Readonly<Record<string, string>>,
): Record<string, string>;
export function serviceEnvironment(
  configuration: Readonly<Record<string, string>>,
): Record<string, string>;
export function render(
  configuration: Readonly<Record<string, string>>,
  envPath: string,
  revision?: string,
): { state: string; composePath: string; services: string[] };

export function writeConfiguration(
  envPath: string,
  configuration: Readonly<Record<string, string>>,
): void;
