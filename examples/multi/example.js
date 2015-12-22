var fs = require('fs');
var Herakles = require('../../lib');

var yaml = fs.readFileSync('./.herakles.yml');
var herakles = Herakles.fromYAML(yaml);

herakles.sync().then(function then() {
  console.log('Everything synced up.');
}).catch(function error(err) {
  console.log('Error while syncing.');
  console.log(err);
  console.log(err.stack);
});
