'use strict';

const fs           = require('fs-extra');
const path         = require('path');
const csvextractor = require('./csvextractor.js');

const missFile     = path.join(__dirname, '../domains.miss.csv');
const platformsDir = path.join(__dirname, '../platforms');

/**
 * This module handles a parser list and is used to find a parser using a domain.
 */
class ParserList {


  constructor() {
    this.domains   = new Map();
    this.platforms = new Map();
    this.missQueue = [];
  }

  /**
   * Push a missing domain in the writing queue
   * @param  {String} domain
   */
  async writeMiss(domain) {
    this.missQueue.push(domain);

    if (this.missQueue.length !== 1) { return; }

    while (this.missQueue.length > 0) {
      const currentDomain = this.missQueue[0];

      try {
        await fs.appendFile(missFile, `\n${currentDomain}`);
      } finally {
        this.missQueue.shift();
      }
    }
  }

  /**
   * Return the size of a specific list
   * @param  {String} type
   */
  sizeOf(type) {
    switch (type) {
    case 'domains':
    case 'platforms':
      return this[type].size;
    default:
      return null;
    }
  }

  /**
   * Add a domain as unknown
   * @param  {String} domain
   */
  addMiss(domain) {
    if (!this.domains.has(domain)) {
      this.domains.set(domain, false);
      return true;
    }
    return false;
  }

  /**
   * Link a parser to a domain
   * @param  {String}  domain
   * @param  {Object}  obj ->
   * {String}  file          path to the parser file
   * {Boolean} isNode        is the parser written with node.js ?
   * {String}  platform      platform short name
   * {String}  platformName  platform complete name
   */
  add(domain, parser) {
    const platform = parser.platform;

    // Unknown domain => init with an empty list of parsers
    if (!this.domains.has(domain)) {
      this.domains.set(domain, []);
    }

    // Unknown platform => init with a parser and an empty Set of domains
    if (!this.platforms.has(platform)) {
      this.platforms.set(platform, { parser, domains: new Set() });
    }

    const platformEntry = this.platforms.get(platform);

    if (!platformEntry.domains.has(domain)) {
      this.domains.get(domain).push(parser);
      platformEntry.domains.add(domain);
    }
  }

  /**
   * Look for the parser of a given domain
   * @param  {String}  domain
   * @param  {Boolean} write  wether we should write in domains.miss or not
   * @return {Object} the corresponding parser or false
   */
  get(domain, write) {
    if (this.domains.has(domain) || this.domains.get(domain) === false) {
      return this.domains.get(domain);
    }
    this.domains[domain] = false;
    if (write !== false) { this.writeMiss(domain); }
    return false;
  }

  /**
   * Look for the parser of a given platform
   * @param  {String} name  the platform name
   * @return {Object} the corresponding parser or false
   */
  getFromPlatform(name) {
    const platform = this.platforms.get(name);
    return platform && platform.parser;
  }

  /**
   * Return the entire domain list
   * @return {Object} the list of all domains
   */
  getAll() {
    return this.domains;
  }

  /**
   * Return the domains of a platform
   * @return {Array} all domains supported by the platform
   */
  getDomainsOf(platform) {
    return this.platforms.get(platform);
  }

  /**
   * Clear cached references of a platform
   */
  clearPlatform(name) {
    const platform = this.platforms.get(name);

    if (!platform) { return; }

    platform.domains.forEach(domain => this.domains.delete(domain));

    this.platforms.delete(name);
  }

  /**
   * Clear cached parsers
   * @return {Array} cleared  parsers that were cached (path to their file)
   */
  clearCachedParsers() {
    for (const { parser } in this.platforms.values()) {
      try {
        delete require.cache[require.resolve(parser.file)];
      } catch (e) {
        continue;
      }
    }
  }

  /**
   * Read platforms directory and build the domains list
   */
  async init() {
    this.domains   = new Map();
    this.platforms = new Map();
    this.missQueue = [];

    const platformsDir = path.resolve(__dirname, '../platforms');

    let items = await fs.readdir(platformsDir);
    // items = ['hw'];

    // Remove .git, .lib, and jsparserskeleton
    items = items.filter(i => !i.startsWith('.') && i != 'js-parser-skeleton');

    for (const item of items) {
      const stat = await fs.stat(path.resolve(platformsDir, item));

      if (stat.isDirectory()) {
        await this.addDomainsOf(item);
      }
    }

    /**
     * Extract missing domains from domains.miss.csv
     * Generate the file if it does not exist
     * Remove domains that are now supported and sort the others
     */
    let missFileContent;
    try {
      missFileContent = await fs.readFile(missFile, 'utf-8');
    } catch (err) {
      if (err.code !== 'ENOENT') { return Promise.reject(err); }
    }

    let lines = (missFileContent || '').split('\n');
    const firstLine = lines.shift().trim();

    if (firstLine !== 'domain') {
      await fs.writeFile(missFile, 'domain');
    }

    lines = lines
      .filter(domain => this.addMiss(domain))
      .sort((a, b) => (a.toLowerCase() > b.toLowerCase() ? 1 : -1));

    await fs.writeFile(missFile, `domain\n${lines.join('\n')}`);
  }

  /**
   * Find the domains supported by a platform and add them to the list
   * @param  {String} platform  the platform short name
   */
  async addDomainsOf(platform) {
    const platformDir  = path.resolve(platformsDir, platform);
    const manifestFile = path.resolve(platformDir, 'manifest.json');
    const parserFile   = path.resolve(platformDir, 'parser.js');
    const pkbFolder    = path.resolve(platformDir, 'pkb');

    const manifest = JSON.parse(await fs.readFile(manifestFile));

    if (!manifest.name) { return; }
    if (!manifest.domains && !manifest['pkb-domains']) { return; }

    await fs.stat(parserFile);

    const parser = {
      file: parserFile,
      platform: manifest.name,
      platformName: manifest.longname,
      publisherName: manifest.publisher_name
    };

    (manifest.domains || []).forEach(domain => this.add(domain, parser));

    const domainsPkbField = manifest['pkb-domains'];

    if (!domainsPkbField) { return; }

    const files = await fs.readdir(pkbFolder);

    const pkbFiles = files
      .filter(f => /_[0-9]{4}-[0-9]{2}-[0-9]{2}\.txt$/.test(f))
      .map(f => path.resolve(pkbFolder, f));

    if (pkbFiles.length === 0) { return; }

    const opts = {
      silent: true,
      fields: [domainsPkbField],
      delimiter: '\t'
    };

    const records = await new Promise((resolve, reject) => {
      csvextractor.extract(pkbFiles, opts, function (err, records) {
        if (err) { reject(err); }
        else { resolve(records); }
      });
    });

    records.forEach(record => {
      const domain = record[domainsPkbField];
      if (domain) {
        this.add(domain, parser);
      }
    });
  }
}

module.exports = new ParserList();
