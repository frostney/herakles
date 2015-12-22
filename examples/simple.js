var Herakles = require('../lib');

var herakles = new Herakles('./');

herakles.addRepository('tmp', 'test', 'github:nodegit/test');

herakles.find('tmp/test').sync().then(function then() {
  console.log('Everything synced up.');
}).catch(function error(err) {
  console.log('Error while syncing.');
  console.log(err);
  console.log(err.stack);
});
