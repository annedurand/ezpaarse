'use strict';

/**
 * This module handles a parser list and is used to find a parser using a domain.
 */

var fs           = require('fs-extra');
var path         = require('path');
var csvextractor = require('./csvextractor.js');

var missFile     = path.join(__dirname, '../domains.miss.csv');
var platformsDir = path.join(__dirname, '../platforms');

function ParserList() {
  this.parsers   = {};
  this.domains   = {};
  this.platforms = {};

  this.missQueue = [];
}
module.exports = new ParserList();

/**
 * Push a missing domain in the writing queue
 * @param  {String} domain
 */
ParserList.prototype.writeMiss = function (domain) {
  var self = this;
  this.missQueue.push(domain);

  if (this.missQueue.length !== 1) { return; }

  (function writeNextDomain() {
    if (self.missQueue.length === 0) { return; }

    var currentDomain = self.missQueue[0];
    fs.appendFile(missFile, '\n' + currentDomain, function () {
      self.missQueue.shift();
      writeNextDomain();
    });
  })();
};

/**
 * Return the size of a specific list
 * @param  {String} type
 */
ParserList.prototype.sizeOf = function (type) {
  switch (type) {
  case 'parsers':
  case 'domains':
  case 'platforms':
    return Object.keys(this[type]).length;
  default:
    return null;
  }
};

/**
 * Add a domain as unknown
 * @param  {String} domain
 */
ParserList.prototype.addMiss = function (domain) {
  if (!this.domains[domain]) {
    this.domains[domain] = false;
    return true;
  }
  return false;
};

/**
 * Link a parser to a domain
 * @param  {String}  domain
 * @param  {Object}  obj ->
 * {String}  file          path to the parser file
 * {Boolean} isNode        is the parser written with node.js ?
 * {String}  platform      platform short name
 * {String}  platformName  platform complete name
 */
ParserList.prototype.add = function (domain, obj) {
  var platform = obj.platform;

  if (this.domains[domain]) {
    return false;
  }

  if (!this.parsers[platform]) {
    this.parsers[platform] = obj;
  }
  if (!this.platforms[platform]) {
    this.platforms[platform] = [];
  }

  this.domains[domain] = this.parsers[platform];
  this.platforms[platform].push(domain);
  return true;
};

/**
 * Look for the parser of a given domain
 * @param  {String}  domain
 * @param  {Boolean} write  wether we should write in domains.miss or not
 * @return {Object} the corresponding parser or false
 */
ParserList.prototype.get = function (domain, write) {
  if (this.domains[domain] || this.domains[domain] === false) {
    return this.domains[domain];
  }
  this.domains[domain] = false;
  if (write !== false) { this.writeMiss(domain); }
  return false;
};

/**
 * Look for the parser of a given platform
 * @param  {String}  platform
 * @return {Object} the corresponding parser or false
 */
ParserList.prototype.getFromPlatform = function (platform) {
  if (this.parsers[platform]) {
    return this.parsers[platform];
  }
  return false;
};

/**
 * Return the entire parser list
 * @return {Object} the list of all parsers
 */
ParserList.prototype.getAll = function () {
  return this.domains;
};

/**
 * Return the domains of a platform
 * @return {Array} all domains supported by the platform
 */
ParserList.prototype.getDomainsOf = function (platform) {
  return this.platforms[platform];
};

/**
 * Clear cached references of a platform
 */
ParserList.prototype.clearPlatform = function (platform) {
  var self = this;
  delete this.parsers[platform];

  this.platforms[platform].forEach(function (domain) {
    delete self.domains[domain];
  });

  this.platforms[platform] = [];
};

/**
 * Clear cached parsers
 * @return {Array} cleared  parsers that were cached (path to their file)
 */
ParserList.prototype.clearCachedParsers = function () {

  for (var p in this.parsers) {
    var file = this.parsers[p].file;
    try {
      delete require.cache[require.resolve(file)];
    } catch (e) {
      continue;
    }
  }
};

/**
 * Read platforms directory and build the domains list
 * @param  {Function} callback
 */
ParserList.prototype.init = function (callback) {
  var self = this;

  this.parsers   = {};
  this.domains   = {};
  this.platforms = {};
  this.missQueue = [];

  var platformsDir = path.join(__dirname, '../platforms');
  var errors       = [];
  var duplicates   = [];

  fs.readdir(platformsDir, function (err, items) {
    if (err) { return callback([err]); }

    // Remove .git, .lib, and jsparserskeleton
    items = items.filter(i => !i.startsWith('.') && i != 'js-parser-skeleton');

    (function nextItem() {
      var item = items.pop();

      if (!item) { return buildMissingDomains(); }

      fs.stat(path.join(platformsDir, item), function (err, stat) {
        if (err) {
          errors.push(err);
          return nextItem();
        }

        if (!stat.isDirectory()) {
          return nextItem();
        }

        self.addDomainsOf(item, function (err, dupl) {
          if (err) { errors.push(err); }
          if (dupl) { duplicates = duplicates.concat(dupl); }

          nextItem();
        });
      });
    })();

    function buildMissingDomains() {
      /**
       * Extract missing domains from domains.miss.csv
       * Generate the file if it does not exist
       * Remove domains that are now supported and sort the others
       */
      fs.readFile(missFile, 'utf-8', function (err, content) {
        if (err) {
          if (err.code !== 'ENOENT') { errors.push(err); }
          return callback(errors, duplicates);
        }

        var lines     = content.split('\n');
        var firstLine = lines.shift().trim();

        if (firstLine !== 'domain') {
          fs.writeFile(missFile, 'domain', function (err) {
            if (err) { errors.push(err); }
            callback(errors, duplicates);
          });
          return;
        }

        lines = lines.filter(function (domain) {
          return self.addMiss(domain);
        }).sort(function (a, b) {
          return (a.toLowerCase() > b.toLowerCase() ? 1 : -1);
        });

        fs.writeFile(missFile, 'domain\n' + lines.join('\n'), function (err) {
          if (err) { errors.push(err); }
          callback(errors, duplicates);
        });
      });
    }
  });
};

/**
 * Find the domains supported by a platform and add them to the list
 * @param  {String}   platform  the platform short name
 * @param  {Function} callback
 */
ParserList.prototype.addDomainsOf = function (platform, callback) {
  var self = this;

  var selfDomains  = {};
  var duplicates   = [];
  var platformDir  = path.join(platformsDir, platform);
  var manifestFile = path.join(platformDir, 'manifest.json');
  var parserFile   = path.join(platformDir, 'parser.js');

  fs.readFile(manifestFile, function (err, json) {
    if (err) {
      return callback(new Error('Could not read the manifest of ' + platform));
    }

    var manifest;
    try { manifest = JSON.parse(json); }
    catch (e) {
      return callback(new Error('Failed to parse the manifest of ' + platform));
    }

    if (!manifest.name || !manifest.domains && !manifest['pkb-domains']) {
      return callback(new Error('No domain found for ' + platform));
    }

    var domainsPkbField = manifest['pkb-domains'];

    fs.exists(parserFile, function (exists) {

      if (!exists) {
        return callback(new Error('No parser found for ' + platform));
      }

      (manifest.domains || []).forEach(function (domain) {
        if (selfDomains.hasOwnProperty(domain)) { return; }

        var unique = self.add(domain, {
          file: parserFile,
          platform: manifest.name,
          platformName: manifest.longname,
          publisherName: manifest.publisher_name
        });

        if (unique) {
          selfDomains[domain] = true;
        } else {
          duplicates.push({
            domain: domain,
            first: self.get(domain).platform,
            ignored: manifest.name
          });
        }
      });

      if (!domainsPkbField) { return callback(null, duplicates); }

      var pkbFolder = path.join(platformDir, 'pkb');

      fs.readdir(pkbFolder, function (err, files) {
        if (err) {
          return callback(new Error('PKB of ' + platform + ' not found'));
        }

        var pkbFiles = files
          .filter(f => /_[0-9]{4}-[0-9]{2}-[0-9]{2}\.txt$/.test(f))
          .map(f => path.join(pkbFolder, f));

        if (pkbFiles.length === 0) {
          return callback(new Error('PKB of ' + platform + ' not found'));
        }

        var opts = {
          silent: true,
          fields: [domainsPkbField],
          delimiter: '\t'
        };

        csvextractor.extract(pkbFiles, opts, function (err, records) {
          if (err) { return callback(new Error('Syntax error into the PKB of ' + platform)); }

          // TODO: what if the same domain is on multiple entries ?
          records.forEach(function (record) {
            var domain = record[domainsPkbField];
            if (selfDomains.hasOwnProperty(domain)) { return; }

            var unique = self.add(domain, {
              file: parserFile,
              platform: manifest.name,
              platformName: manifest.longname,
              publisherName: manifest.publisher_name
            });

            if (unique) {
              selfDomains[domain] = true;
            } else {
              duplicates.push({
                domain: domain,
                first: self.get(domain).platform,
                ignored: manifest.name
              });
            }
          });

          callback(null, duplicates);
        });
      });
    });
  });
};
