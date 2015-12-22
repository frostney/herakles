var Herakles = require('./lib');

var herakles = new Herakles('./');

herakles.addRepository('games', 'flockn', 'github:flockn/flockn');

var a = function() {
  console.log(arguments);
};

herakles.find('games/flockn').sync().then(a).catch(a);
