export function optionalFlag<T>(parse: (value: string) => T, brief: string, placeholder: string) {
  return { kind: "parsed", parse, optional: true, brief, placeholder } as const;
}

export function booleanFlag(brief: string) {
  return { kind: "boolean", optional: true, brief } as const;
}

export const looseBooleanParser = (value: string) => {
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Expected a boolean, received: ${value}`);
};
