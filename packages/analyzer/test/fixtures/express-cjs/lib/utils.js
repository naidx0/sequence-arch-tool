'use strict';

exports.compileETag = function () {
  return '"etag"';
};

exports.formatUrl = function formatUrl(path) {
  return path;
};

exports.duplicate = function () {
  return 1;
};

exports.duplicate = function () {
  return 2;
};

function useEtag() {
  exports.compileETag();
}

module.exports = exports;
