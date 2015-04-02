// Handler functions for the /assets endpoint.

var
  async = require('async'),
  pkgcloud = require('pkgcloud'),
  fs = require('fs'),
  path = require('path'),
  crypto = require('crypto'),
  config = require('./config'),
  logging = require('./logging');

var log = logging.getLogger(config.content_log_level());

/**
 * @description Calculate a checksum of an uploaded file's contents to generate
 *   the fingerprinted asset name.
 */
function fingerprint(asset, callback) {
  var
    sha256sum = crypto.createHash('sha256'),
    asset_file = fs.createReadStream(asset.path),
    chunks = [];

  asset_file.on('data', function (chunk) {
    sha256sum.update(chunk);
    chunks.push(chunk);
  });

  asset_file.on('error', callback);

  asset_file.on('end', function() {
    var
      digest = sha256sum.digest('hex'),
      ext = path.extname(asset.name),
      basename = path.basename(asset.name, ext),
      fingerprinted = basename + "-" + digest + ext;

    log.debug("Fingerprinted asset [" + asset.name + "] as [" + fingerprinted + "].");

    callback(null, {
      original: asset.name,
      chunks: chunks,
      filename: fingerprinted,
      type: asset.type,
    });
  });
}

/**
 * @description Upload an asset's contents to the asset container.
 */
function publish(asset, callback) {
  var up = config.client.upload({
    container: config.asset_container(),
    remote: asset.filename,
    contentType: asset.type,
    headers: { 'Access-Control-Allow-Origin': '*' }
  });

  up.on('error', callback);

  up.on('finish', function () {
    log.debug("Successfully uploaded asset [" + asset.filename + "].");

    callback(null, asset);
  });

  for (var chunk in asset.chunks) {
    up.write(chunk);
  }
  up.end();
}

/**
 * @description Process a single asset.
 */
function handleAsset(asset, callback) {
  log.debug("Processing uploaded asset [" + asset.name + "].");

  async.waterfall([
    async.apply(fingerprint, asset),
    publish
  ], callback);
}

/**
 * @description Fingerprint and upload static, binary assets to the
 *   CDN-enabled ASSET_CONTAINER. Return a JSON object containing a
 *   map of the provided filenames to their final, public URLs.
 */
exports.accept = function (req, res, next) {
  var assetData = Object.getOwnPropertyNames(req.files).map(function (key) {
    return req.files[key];
  });

  async.map(assetData, handleAsset, function (err, results) {
    if (err) {
      log.error("Unable to process an asset.", err);

      res.status(500);
      res.send({
        error: "Unable to upload one or more assets!"
      });
      next();
    }

    var summary = {};
    results.forEach(function (result) {
      // FIXME derive this from the asset_container object.
      var public_url = "wat";

      summary[result.original] = public_url;
    });
    log.debug("All assets have been processed succesfully.", summary);

    res.status(200);
    res.send(summary);
    next();
  });
};
