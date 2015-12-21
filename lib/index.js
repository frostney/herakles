var path = require('path');

var yaml = require('js-yaml');

var Group = require('./Group');

var Promise = (typeof Promise === 'undefined') ? require('pinkie-promise') : Promise;

var Herakles = function Herakles(baseDirectory) {
  this.children = {};
  this.baseDirectory = baseDirectory;
};

Herakles.prototype.addGroup = function addGroup(name) {
  this.children[name] = new Group();
  this.children[name].baseDirectory = path.join(this.baseDirectory, name);
};

Herakles.prototype.addRepository = function addRepository(group, name, location) {
  if (!Object.hasOwnProperty.call(this.children, group)) {
    this.addGroup(group);
  }

  this.children[group].addRepository(name, location);
};

Herakles.prototype.find = function find(name) {
  var arr = name.split('/');

  var context = this.children;
  arr.forEach(function forEach(element) {
    if (!element || !context[element]) {
      throw new Error('Could not find ' + name);
    }

    context = context[element];
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
  var promises = this.toArray().map(function map(child) {
    return child.sync();
  });

  return Promise.all(promises);
};

Herakles.toJSON = function toJSON() {
  return this.toArray().map(function map(group) {
    var serializable = {};

    serializable[group] = self.groups[group].toJSON();

    return serializable;
  });
};

Herakles.fromJSON = function fromJSON(content) {
  return new Herakles();
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
