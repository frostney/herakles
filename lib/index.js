var path = require('path');

var yaml = require('js-yaml');

var flattenObject = require('./flattenObject');
var Group = require('./Group');

var Promise = (typeof Promise === 'undefined') ? require('pinkie-promise') : Promise;

var Herakles = function Herakles(baseDirectory) {
  this.scripts = {};
  this.children = {};
  this.baseDirectory = baseDirectory || process.cwd();
};

Herakles.prototype.addGroup = function addGroup(name) {
  if (!Object.hasOwnProperty.call(this.children, name)) {
    this.children[name] = new Group();
    this.children[name].baseDirectory = path.join(this.baseDirectory, name);
  }

  return this.children[name];
};

Herakles.prototype.addRepository = function addRepository(group, name, location) {
  var groupArray = (Array.isArray(group)) ? group : [group];

  var context = this;

  groupArray.forEach(function forEach(groupName) {
    context = context.addGroup(groupName);
  });

  return context.addRepository(name, location);
};

Herakles.prototype.find = function find(name) {
  var arr = name.split('/');

  var context = this;
  // TODO: Provide API for access
  arr.forEach(function forEach(element) {
    var child = context[element] || context.children[element];

    if (element && child) {
      context = child;
    } else {
      throw new Error('Could not find ' + name);
    }
  });

  return context;
};

Herakles.prototype.toArray = function toArray() {
  return Object.keys(this.children).map(function map(name) {
    return this.children[name];
  }, this);
};

Herakles.prototype.toJSON = function toJSON() {
  return this.toArray().map(function map(child) {
    return child.toJSON();
  });
};

Herakles.prototype.sync = function sync() {
  var initialPromise = Promise.resolve();
  return this.toArray().reduce(function reducer(syncPromise, child) {
    return syncPromise = syncPromise.then(function syncThen() {
      return child.sync();
    });
  }, initialPromise);
};

Herakles.toJSON = function toJSON() {
  return this.toArray().map(function map(group) {
    var serializable = {};

    serializable[group] = self.groups[group].toJSON();

    return serializable;
  });
};

Herakles.fromJSON = function fromJSON(content) {
  var herakles = new Herakles();

  var repositories = flattenObject(content.repositories);

  herakles.scripts = content.scripts;

  Object.keys(repositories).forEach(function forEach(chain) {
    var name = chain.split('/');

    var group = name.slice(0, name.length - 1);
    var repository = name[name.length - 1];

    var location = repositories[chain];

    herakles.addRepository(group, repository, location);
  });

  return herakles;
};

Herakles.fromYAML = function fromYAML(content) {
  var doc = null;

  try {
    doc = yaml.safeLoad(content);

    return Herakles.fromJSON(doc);
  } catch (e) {
    throw e;
  }
};

module.exports = Herakles;
