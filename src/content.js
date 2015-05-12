// Store, retrieve, and delete metadata envelopes.

var
  async = require('async'),
  _ = require('lodash'),
  config = require('./config'),
  connection = require('./connection'),
  log = require('./logging').getLogger();

/**
 * @description Download the raw metadata envelope from Cloud Files.
 */
function downloadContent(contentID, callback) {
  var source = connection.client.download({
    container: config.contentContainer(),
    remote: encodeURIComponent(contentID)
  });
  var chunks = [];

  source.on('error', function (err) {
    callback(err);
  });

  source.on('data', function (chunk) {
    chunks.push(chunk);
  });

  source.on('end', function () {
    var
      complete = Buffer.concat(chunks),
      envelope = JSON.parse(complete);

    callback(null, {envelope: envelope});
  });
}

/**
 * @description Inject asset variables included from the /assets endpoint into
 *   an outgoing metadata envelope.
 */
function injectAssetVars(doc, callback) {
  log.debug("Collecting asset variables to inject into the envelope.");

  connection.db.collection("layoutAssets").find().toArray(function (err, assetVars) {
    if (err) {
      callback(err);
      return;
    }

    log.debug("Injecting " + assetVars.length + " variables into the envelope.");

    var assets = {};

    for (i = 0; i < assetVars.length; i++) {
      var assetVar = assetVars[i];
      assets[assetVar] = assetVar.publicURL;
    }

    doc.assets = assets;

    callback(null, doc);
  });
}

/**
 * @description Store an incoming metadata envelope within Cloud Files.
 */
function storeEnvelope(doc, callback) {
  var dest = connection.client.upload({
    container: config.contentContainer(),
    remote: encodeURIComponent(doc.contentID)
  });

  dest.end(JSON.stringify(doc.envelope), function (err) {
    if (err) return callback(err);

    callback(null, doc);
  });
}

/**
 * @description Persist selected attributes from a metadata envelope in an indexed Mongo collection.
 */
function indexEnvelope(doc, callback) {
  var subdoc = _.pick(doc.envelope, ["title", "publish_date", "tags", "categories"]);

  subdoc.content_id = doc.contentID;

  connection.db.collection("envelopes").insertOne(subdoc, function (err, db) {
    if (err) return callback(err);
    callback(null, doc);
  });
}

/**
 * @description Retrieve content from the store by content ID.
 */
exports.retrieve = function (req, res, next) {
  log.debug("Requesting content ID: [" + req.params.id + "]");

  async.waterfall([
    async.apply(downloadContent, req.params.id),
    injectAssetVars
  ], function (err, doc) {
    if (err) {
      log.error("Failed to retrieve a metadata envelope", err);

      res.status(err.statusCode || 500);
      res.send();
      next();

      return;
    }

    res.json(doc);
    next();
  });
};

/**
 * @description Store new content into the content service.
 */
exports.store = function (req, res, next) {
  log.info("(" + req.apikeyName + ") Storing content with ID: [" + req.params.id + "]");

  var doc = {
    contentID: req.params.id,
    envelope: req.body
  };

  async.waterfall([
    async.apply(storeEnvelope, doc),
    indexEnvelope
  ], function (err, doc) {
    next.ifError(err);

    res.send(204);
    next();
  });
};

/**
 * @description Delete a piece of previously stored content by content ID.
 */
exports.delete = function (req, res, next) {
  log.info("(" + req.apikeyName + ") Deleting content with ID [" + req.params.id + "]");

  connection.client.removeFile(config.contentContainer(), encodeURIComponent(req.params.id), function (err) {
    next.ifError(err);

    res.send(204);
    next();
  });
};
