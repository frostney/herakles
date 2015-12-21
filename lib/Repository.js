var mkdirp = require('mkdirp-promise');
var nodegit = require('nodegit');

var Promise = (typeof Promise === 'undefined') ? require('pinkie-promise') : Promise;

var expandShorthand = function expandShorthand(shorthand) {
  var removeAbbreviation = function removeAbbreviation(short, abbreviation) {
    return short.split(abbreviation)[1];
  };

  if (shorthand.indexOf('github:') === 0) {
    return 'git@github.com:' + removeAbbreviation(shorthand, 'github:') + '.git';
  }

  if (shorthand.indexOf('bitbucket:') === 0) {
    return 'git@bitbucket.org:' + removeAbbreviation(shorthand, 'bitbucket:') + '.git';
  }

  return shorthand;
};

var Repository = function Repository(location) {
  this.location = expandShorthand(location);
  this.baseDirectory = '';
};

Repository.prototype.toJSON = function toJSON() {
  return location;
};

Repository.prototype.create = function create() {

};

Repository.prototype.sync = function sync() {
  var self = this;

  var opts = {
    fetchOpts: {
      callbacks: {
        certificateCheck: function certificateCheck() {
          return 1;
        },
        credentials: function credentials(url, userName) {
          return nodegit.Cred.sshKeyFromAgent(userName);
        },
      },
    },
  };

  return mkdirp(this.baseDirectory).then(function() {
    return nodegit.Repository.open(self.baseDirectory).then(function(repository) {
      console.log('fetch');
      return repository.fetch();
    }).catch(function() {
      return nodegit.Clone.clone(self.location, self.baseDirectory, opts);
    });
  });
};

module.exports = Repository;
