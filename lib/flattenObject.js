var flattenObject = function flattObject(ob) {
  var result = {};
  var i;
  var j;
  var flatObject;

  for (i in ob) {
    if (!Object.hasOwnProperty.call(ob, i)) {
      continue;
    }

    if (typeof ob[i] === 'object' && ob !== null) {
      flatObject = flattenObject(ob[i]);

      for (j in flatObject) {
        if (!Object.hasOwnProperty.call(flatObject, j)) {
          continue;
        }

        result[i + '/' + j] = flatObject[j];
      }
    } else {
      result[i] = ob[i];
    }
  }

  return result;
};

module.exports = flattenObject;
