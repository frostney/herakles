type DefinedProperties<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Copy a plain data record, omitting only undefined values. */
export function definedProperties<T extends object>(values: T): DefinedProperties<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as DefinedProperties<T>;
}
