var Promise = (typeof Promise === 'undefined') ? require('pinkie-promise') : Promise;

function series(list) {
  var p = Promise.resolve();
  return list.reduce(function(pacc, fn) {
    return pacc = pacc.then(fn);
  }, p);
}

module.exports = series;
