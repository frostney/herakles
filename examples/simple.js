var Herakles = require('../lib');

var herakles = new Herakles('./');

herakles.addRepository('tmp', 'test', 'github:nodegit/test');

herakles.find('tmp/test').sync().then(function then() {
  console.log('Everything synced up.');
}).catch(function error() {
  console.log('Error while syncing.');
});
