export const flattenObject = (ob: object) => {
  const result = {};

  let flatObject: object;

  for (let i in ob) {
    if (!Object.prototype.hasOwnProperty.call(ob, i)) {
      continue;
    }

    if (typeof ob[i] === "object" && ob !== null) {
      flatObject = flattenObject(ob[i]);

      for (letj in flatObject) {
        if (!Object.prototype.hasOwnProperty.call(flatObject, j)) {
          continue;
        }

        result[i + "/" + j] = flatObject[j];
      }
    } else {
      result[i] = ob[i];
    }
  }

  return result;
};
