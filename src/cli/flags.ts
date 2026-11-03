export function optionalFlag<T>(parse: (value: string) => T, brief: string, placeholder: string) {
  return { kind: "parsed", parse, optional: true, brief, placeholder } as const;
}

export function booleanFlag(brief: string) {
  return { kind: "boolean", optional: true, brief } as const;
}
