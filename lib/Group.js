var path = require('path');

var Repository = require('./Repository');

var Promise = (typeof Promise === 'undefined') ? require('pinkie-promise') : Promise;

var Group = function Group(repositories) {
  this.children = {};
  this.baseDirectory = '';

  if (repositories) {
    Object.keys(repositories).forEach(function forEach(repository) {
      this.addRepository(repository, repositories[repository]);
    }, this);
  }
};

Group.prototype.addGroup = function addGroup(name) {
  this.children[name] = new Group();
  this.children[name].baseDirectory = path.join(this.baseDirectory, name);
};

Group.prototype.addRepository = function addRepository(name, location) {
  this.children[name] = new Repository(location);
  this.children[name].baseDirectory = path.join(this.baseDirectory, name);
};

Group.prototype.removeRepository = function removeRepository(name) {
  delete this.children[name];
};

Group.prototype.toArray = function toArray() {
  return Object.keys(this.children).map(function map(name) {
    return this.children[name];
  }, this);
};

Group.prototype.toJSON = function toJSON() {
  return this.toArray().map(function map(child) {
    return child.toJSON();
  });
};

Group.prototype.run = function run(command) {
  return this.toArray().map(function map(child) {
    return child.run(command);
  });
};

Group.prototype.sync = function sync() {
  var promises = this.toArray().map(function map(child) {
    return child.sync();
  });

  return Promise.all(promises);
};

module.exports = Group;
