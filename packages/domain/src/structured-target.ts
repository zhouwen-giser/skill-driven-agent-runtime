import { z } from 'zod';

const Pointer = z
  .string()
  .regex(/^(?:\/(?:[^~/]|~[01])*)*$/u)
  .max(1024);
export const StructuredTargetMappingSchema = z
  .array(
    z
      .object({
        argumentPath: Pointer,
        purpose: z.string().trim().min(1).max(128),
        format: z.enum(['geojson', 'xy']),
        crs: z.string().trim().min(1).max(128).optional(),
        crsPath: Pointer.optional(),
      })
      .strict()
      .refine((mapping) => (mapping.crs === undefined) !== (mapping.crsPath === undefined)),
  )
  .max(64)
  .refine((mappings) => new Set(mappings.map((m) => m.argumentPath)).size === mappings.length);

const Position = z.tuple([z.number(), z.number()]);
const Line = z.array(Position).min(2).max(10000);
const Ring = z
  .array(Position)
  .min(4)
  .max(10000)
  .refine(
    (points) => points[0]?.[0] === points.at(-1)?.[0] && points[0]?.[1] === points.at(-1)?.[1],
  );
const GeometrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Point'), coordinates: Position }).strict(),
  z.object({ type: z.literal('LineString'), coordinates: Line }).strict(),
  z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring).min(1).max(100) }).strict(),
]);

export interface StructuredTarget {
  readonly argumentPath: string;
  readonly purpose: string;
  readonly geometry: z.infer<typeof GeometrySchema>;
  readonly nativeCrs: string;
}

export interface TargetExtraction {
  readonly targets: readonly StructuredTarget[];
  readonly diagnostics: readonly {
    argumentPath: string;
    code: 'TARGET_CRS_UNRESOLVED' | 'TARGET_GEOMETRY_INVALID';
  }[];
}

/** Only trusted schema annotations select spatial fields. No coordinate search,
 * expression evaluation, model calls, or guessed coordinate reference systems. */
export function extractStructuredTargets(
  schema: unknown,
  input: unknown,
  options: { deferWorkflowReferences?: boolean } = {},
): TargetExtraction {
  const annotation = record(schema)?.['x-sdar-targets'];
  if (annotation === undefined) return { targets: [], diagnostics: [] };
  const mappings = StructuredTargetMappingSchema.parse(annotation);
  const targets: StructuredTarget[] = [];
  const diagnostics: TargetExtraction['diagnostics'][number][] = [];
  for (const mapping of mappings) {
    const raw = atPointer(input, mapping.argumentPath);
    if (raw === undefined) continue;
    const crs =
      mapping.crs ??
      (mapping.crsPath === undefined ? undefined : atPointer(input, mapping.crsPath));
    if (
      options.deferWorkflowReferences === true &&
      (hasWorkflowReference(raw) || hasWorkflowReference(crs))
    )
      continue;
    if (typeof crs !== 'string' || crs.trim() === '') {
      diagnostics.push({ argumentPath: mapping.argumentPath, code: 'TARGET_CRS_UNRESOLVED' });
      continue;
    }
    const xy = record(raw);
    const geometry = GeometrySchema.safeParse(
      mapping.format === 'xy' ? { type: 'Point', coordinates: [xy?.['x'], xy?.['y']] } : raw,
    );
    if (
      !geometry.success ||
      (crs === 'EPSG:4326' && !wgs84Coordinates(geometry.data.coordinates))
    ) {
      diagnostics.push({ argumentPath: mapping.argumentPath, code: 'TARGET_GEOMETRY_INVALID' });
      continue;
    }
    targets.push({
      argumentPath: mapping.argumentPath,
      purpose: mapping.purpose,
      geometry: geometry.data,
      nativeCrs: crs,
    });
  }
  return { targets, diagnostics };
}

function atPointer(value: unknown, pointer: string): unknown {
  if (pointer === '') return value;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replace(/~1/gu, '/').replace(/~0/gu, '~');
    const object = record(value);
    if (object === undefined || !Object.hasOwn(object, key)) return undefined;
    value = object[key];
  }
  return value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function wgs84Coordinates(value: readonly unknown[]): boolean {
  if (typeof value[0] === 'number')
    return (
      value[0] >= -180 &&
      value[0] <= 180 &&
      typeof value[1] === 'number' &&
      value[1] >= -90 &&
      value[1] <= 90
    );
  return value.every((item) => Array.isArray(item) && wgs84Coordinates(item));
}

function hasWorkflowReference(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasWorkflowReference);
  const object = record(value);
  if (object === undefined) return false;
  if (object['op'] === 'ref' && Array.isArray(object['path'])) return true;
  return Object.values(object).some(hasWorkflowReference);
}
