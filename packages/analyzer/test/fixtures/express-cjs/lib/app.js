'use strict';

function Application() {
  this.cache = {};
}

Application.prototype.configure = function configure() {
  this.setup();
  return this;
};

Application.prototype.setup = function setup() {
  this.set('x-powered-by', true);
};

Application.prototype.set = function set(name, val) {
  this.cache[name] = val;
};

Application.prototype.dispatch = function dispatch(req) {
  this.handle(req);
};

Application.prototype.handle = function handle(req) {
  return req;
};

Application.prototype.listen = function listen(port, app) {
  app.get('/', function handler() {});
};

Application.prototype.ambiguous = function ambiguousFirst() {
  this.helper();
};

function createApplication() {
  return new Application();
}

module.exports = createApplication;
