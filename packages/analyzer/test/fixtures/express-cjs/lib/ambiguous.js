'use strict';

function run() {
  this.helper();
}

function helper() {
  return 1;
}

function helper() {
  return 2;
}

module.exports = { run };
