var fs = require('fs');
var path = require('path');
var execSync = require('child_process').execSync;
var mkdirp = require('mkdirp-promise');
var nodegit = require('nodegit');

var Promise = (typeof Promise === 'undefined') ? require('pinkie-promise') : Promise;

var events = require('./events');

// TODO: Shorthands should be handled more dynamically
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

  if (shorthand.indexOf('gitlab:') === 0) {
    return 'git@gitlab.com:' + removeAbbreviation(shorthand, 'gitlab:') + '.git';
  }

  return shorthand;
};

var Repository = function Repository(location) {
  this.name = '';
  this.location = expandShorthand(location);
  this.baseDirectory = '';
  this.root = null;
};

Repository.prototype.toJSON = function toJSON() {
  return location;
};

Repository.prototype.run = function run(command) {
  return execSync(command, {
    cwd: this.baseDirectory,
  });
};

Repository.prototype.pull = function pull(repository, opts) {
  return repository.fetchAll(opts.fetchOpts).then(function remotesThen() {
    return Promise.all([
      repository.getCurrentBranch(),
      repository.getRemotes(),
    ]);
  }).then(function mergeThen(args) {
    var ref = args[0];
    var remotes = args[1];

    var defaultRemote = remotes[0];
    var shorthand = ref.shorthand();

    // TODO: Not all remotes are called origin
    return repository.mergeBranches(shorthand, defaultRemote + '/' + shorthand);
  });
};

Repository.prototype.push = function push(repository, opts) {
  return Promise.all([
    repository.getCurrentBranch(),
    repository.getRemotes(),
  ]).then(function pushThen(args) {
    var ref = args[0];
    var remotes = args[1];

    var defaultRemote = remotes[0];
    var shorthand = ref.shorthand();

    return repository.getRemote(defaultRemote).then(function pushDirectly(r) {
      return r.push(['refs/heads/' + shorthand + ':refs/heads/' + shorthand], opts.fetchOpts);
    });
  });
};

Repository.prototype.sync = function sync() {
  var repositoryExists = function repositoryExists(p) {
    var result;

    try {
      result = fs.statSync(path.join(p, '.git'));

      return result && result.isDirectory();
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
    }
  };

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

  events.emit('sync:item', {
    name: this.name,
    baseDirectory: this.baseDirectory,
    location: this.location,
  });

  return mkdirp(this.baseDirectory).then(function gitThen() {
    if (!repositoryExists(self.baseDirectory)) {
      return nodegit.Clone.clone(self.location, self.baseDirectory, opts).then(function emitEvent() {
        events.emit('sync:item:clone');
      });
    }

    return nodegit.Repository.open(self.baseDirectory).then(function openThen(repository) {
      return self.pull(repository, opts).then(function emitEvent() {
        events.emit('sync:item:pull');
      });
      // TODO: Pushing is currently not working as expected: It only pushes
      // the refspec, but not the actual changes
      /* .then(function pushChanges() {
        return self.push(repository, opts).catch(function catchPush(err) {
          console.log('Error pushing to repository');
          console.log(err);
        });
      });*/
    });
  });
};

module.exports = Repository;
