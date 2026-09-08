import { z } from 'zod';

const SharedStorageSchema = z
  .object({
    databaseUrl: z
      .url()
      .refine((url) => ['postgres:', 'postgresql:'].includes(new URL(url).protocol)),
    serviceKey: z.string().trim().min(1),
    allowedDeviceIds: z.array(z.string().trim().min(1)),
    deviceId: z.string().trim().min(1).optional(),
    dataScopeKey: z.string().trim().min(1),
    includeNonDevice: z.boolean(),
    contractDirectory: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (new Set(value.allowedDeviceIds).size !== value.allowedDeviceIds.length)
      context.addIssue({ code: 'custom', message: 'Duplicate device scope.' });
    if (value.deviceId !== undefined && !value.allowedDeviceIds.includes(value.deviceId))
      context.addIssue({
        code: 'custom',
        message: 'Configured device is outside the allowed scope.',
      });
    // A URL options parameter would override pg Pool's fixed per-connection options.
    if (new URL(value.databaseUrl).searchParams.has('options'))
      context.addIssue({
        code: 'custom',
        message: 'Database URL must not override connection options.',
      });
  });

export type GowmSharedStorageConfiguration = z.infer<typeof SharedStorageSchema>;

export function parseGowmStorageConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): GowmSharedStorageConfiguration | undefined {
  const mode = environment['SDAR_STORAGE_MODE'] ?? 'standalone';
  if (mode === 'standalone') return undefined;
  if (mode !== 'gowm-shared') throw new Error('SDAR_STORAGE_MODE_INVALID');
  const includeNonDevice = environment['SDAR_INCLUDE_NON_DEVICE_TASKS'] ?? 'false';
  if (!['true', 'false'].includes(includeNonDevice))
    throw new Error('GOWM_STORAGE_CONFIGURATION_INVALID');
  try {
    return SharedStorageSchema.parse({
      databaseUrl: environment['GOWM_DATABASE_URL'],
      serviceKey: environment['SDAR_SERVICE_KEY'],
      allowedDeviceIds: JSON.parse(environment['SDAR_ALLOWED_DEVICE_IDS'] ?? '[]') as unknown,
      deviceId: environment['SDAR_DEVICE_ID'],
      dataScopeKey: environment['SDAR_DATA_SCOPE_KEY'],
      includeNonDevice: includeNonDevice === 'true',
      contractDirectory:
        environment['SDAR_GOWM_CONTRACT_DIR'] ?? 'contracts/gowm-shared-storage/current',
    });
  } catch {
    // Never include a connection URL or parser input in a configuration error.
    throw new Error('GOWM_STORAGE_CONFIGURATION_INVALID');
  }
}
