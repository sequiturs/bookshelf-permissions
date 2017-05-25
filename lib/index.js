'use strict';

var BluebirdPromise = require('bluebird');
var _ = require('lodash');

function BookshelfPermissionsPluginBreakOutOfReduceError(earlyResult) {
  this.earlyResult = earlyResult;
  this.name = 'BookshelfPermissionsPluginBreakOutOfReduceError';
  Error.captureStackTrace(this, BookshelfPermissionsPluginBreakOutOfReduceError);
}
BookshelfPermissionsPluginBreakOutOfReduceError.prototype = Object.create(Error.prototype);
BookshelfPermissionsPluginBreakOutOfReduceError.prototype.constructor = BookshelfPermissionsPluginBreakOutOfReduceError;

function BookshelfPermissionsPluginPermissionError(message) {
  this.message = message;
  this.name = 'BookshelfPermissionsPluginPermissionError';
  Error.captureStackTrace(this, BookshelfPermissionsPluginPermissionError);
}
BookshelfPermissionsPluginPermissionError.prototype = Object.create(Error.prototype);
BookshelfPermissionsPluginPermissionError.prototype.constructor = BookshelfPermissionsPluginPermissionError;

function BookshelfPermissionsPluginSanityError(message) {
  this.message = message;
  this.name = 'BookshelfPermissionsPluginSanityError';
  Error.captureStackTrace(this, BookshelfPermissionsPluginSanityError);
}
BookshelfPermissionsPluginSanityError.prototype = Object.create(Error.prototype);
BookshelfPermissionsPluginSanityError.prototype.constructor = BookshelfPermissionsPluginSanityError;

/**
 * @desc
 */
module.exports = {
  errors: {
    'BookshelfPermissionsPluginPermissionError': BookshelfPermissionsPluginPermissionError
  },
  configure: function(options) {
    options = options || {};
    var useWithBookshelfAdvancedSerializationPlugin =
      options.useWithBookshelfAdvancedSerializationPlugin || false;
    var DefaultDoesNotHavePermissionError =
      options.DefaultDoesNotHavePermissionError || BookshelfPermissionsPluginPermissionError;

    return function(Bookshelf) {
      Bookshelf.Model = Bookshelf.Model.extend({

        /**
         * @desc N.B. This method does not throw an error for failed authorization at
         * the defined level; if any of the authorization feature evaluators threw
         * an error, that error is included in the result at
         * `authorizationFeatureEvaluatorError`.
         */
        __evaluateAuthorizationLevel: function(definition, accessor) {
          // TODO Sanity-check that definition is an object with the right shape

          var requiredAuthorizationFeatures = _.map(definition.requiredAuthorizationFeatures, function(featureName) {
            var feature = this._authorizationFeatures[featureName];
            if (!feature) {
              // TODO Validate shape of feature.
              throw new BookshelfPermissionsPluginSanityError('No authorization feature found: `' + featureName + '`.');
            }
            return feature;
          }.bind(this));

          // Evaluate the authorization feature evaluators in order, so that
          // result is deterministic.
          return BluebirdPromise.reduce(requiredAuthorizationFeatures, function(reducerResult, feature, i) {
            // Wrap authorization feature evaluator in BluebirdPromise.method()
            // so that it may determine its result asynchronously, but throw
            // synchronously if it wants to.
            var featureEvaluator = BluebirdPromise.method(feature.evaluator);

            var evaluatorArgumentsAccessorKeys = feature.evaluatorArgumentsAccessorKeys;
            if (!evaluatorArgumentsAccessorKeys) {
              throw new BookshelfPermissionsPluginSanityError('Authorization feature must define `evaluatorArgumentsAccessorKeys`.');
            }

            var featureEvaluatorArguments = _.map(feature.evaluatorArgumentsAccessorKeys, function(key) {
              if (accessor.hasOwnProperty(key)) {
                return accessor[key];
              } else {
                throw new BookshelfPermissionsPluginSanityError('`accessor` must have property `' + key + '`.');
              }
            });

            // Feature evaluator will be treated as establishing that accessor does not
            // have the authorization feature, if the evaluator resolves to a rejected promise,
            // or if it resolves to a fulfilled promise with a falsey value. Otherwise,
            // it will be treated as establishing that accessor does have the authorization feature.
            return featureEvaluator.apply(this, featureEvaluatorArguments)
              .catch(function(e) {
                // If featureEvaluator threw an error, catch and throw breakout error
                // wrapping that error.
                throw new BookshelfPermissionsPluginBreakOutOfReduceError({
                  hasAuthorizationFeature: false,
                  authorizationFeature: definition.requiredAuthorizationFeatures[i],
                  authorizationFeatureEvaluatorError: e
                });
              })
              .then(function(featureEvaluatorResult) {
                if (featureEvaluatorResult) {
                  return true;
                } else {
                  // If featureEvaluatorResult is falsey, throw breakout error
                  throw new BookshelfPermissionsPluginBreakOutOfReduceError({
                    hasAuthorizationFeature: false,
                    authorizationFeature: definition.requiredAuthorizationFeatures[i],
                    authorizationFeatureEvaluatorError: null
                  });
                }
              });
          }.bind(this), false).then(function(reducerResult) {
            if (reducerResult === true) {
              return { isAuthorized: true };
            } else {
              // TODO Throw SanityError, because we'd expect a false result to have
              // broken out of the reduce
            }
          })
          .catch(BookshelfPermissionsPluginBreakOutOfReduceError, function(e) {
            return {
              isAuthorized: false,
              failedAuthorizationFeature: e.earlyResult.authorizationFeature,
              authorizationFeatureEvaluatorError: e.earlyResult.authorizationFeatureEvaluatorError
            };
          })
          .then(function(isAuthorizedForLevelResult) {
            // TODO Sanity-check that isAuthorizedForLevelResult.isAuthorized is a boolean
            // TODO Sanity-check that isAuthorizedForLevelResult.failedAuthorizationFeature is a string if not authorized
            return {
              authorizationLevelName: definition.authorizationLevelName,
              isAuthorized: isAuthorizedForLevelResult.isAuthorized,
              failedAuthorizationFeature: isAuthorizedForLevelResult.isAuthorized ?
                undefined :
                isAuthorizedForLevelResult.failedAuthorizationFeature,
              authorizationFeatureEvaluatorError: isAuthorizedForLevelResult.isAuthorized ?
                undefined :
                isAuthorizedForLevelResult.authorizationFeatureEvaluatorError
            };
          });
        },
        /**
         * @desc Iterates through defined authorization levels for specified permission,
         * from left to right, returning a result for the first for which all
         * authorization features are satisfied. If there are authorization levels
         * defined but none are satisfied, the result for the last level is returned.
         * If there are no authorization levels defined, a mostly empty default
         * result which denies that the accessor is authorized for the permission
         * is returned.
         * @returns {Promise<object>} The result representing whether the accessor
         * is authorized for the requested permission.
         */
        _getFirstAuthorizedAuthorizationLevelForPermission: BluebirdPromise.method(function(permission, accessor) {
          var authorizationLevelDefinitions = this.permissions[permission];

          if (!authorizationLevelDefinitions || !Array.isArray(authorizationLevelDefinitions)) {
            throw new BookshelfPermissionsPluginSanityError('`permissions.' + permission + '` must be a list.');
          }

          // TODO Sanity-check that authorizationLevelDefinitions all have an authorizationLevelName
          // and that none are duplicates.
          // TODO Could give authorizationLevelDefinition a name of `'default'` if user hasn't specified
          // one and there is only one authorizationLevelDefinition for the permission.

          return BluebirdPromise.reduce(authorizationLevelDefinitions, function(reducerResult, definition) {
            return this.__evaluateAuthorizationLevel(definition, accessor)
              .then(function(evaluation) {
                if (evaluation.isAuthorized) {
                  throw new BookshelfPermissionsPluginBreakOutOfReduceError(evaluation);
                } else {
                  return evaluation;
                }
              });
          }.bind(this), {
            authorizationLevelName: undefined,
            isAuthorized: false,
            failedAuthorizationFeature: undefined,
            authorizationFeatureEvaluatorError: undefined
          }).then(function(reducerResult) {
            if (reducerResult.isAuthorized) {
              // TODO Throw SanityError, because we'd expect a true result to have broken out of the reduce
            }
            return reducerResult;
          })
          .catch(BookshelfPermissionsPluginBreakOutOfReduceError, function(e) {
            return e.earlyResult;
          })
          .then(function(firstAuthorizedAuthorizationLevelResult) {
            return firstAuthorizedAuthorizationLevelResult;
          });
        }),

        /**
         * @desc Evaluates whether `accessor` is authorized for the `permission`.
         * @returns {Promise<object>} `this` if the accessor is authorized for the permission.
         * @throws {*} An error if the accessor is not authorized for the permission.
         */
        checkHasPermission: BluebirdPromise.method(function(permission, accessor, options) {
          // TODO If using with bookshelf-advanced-serialization, or even if not,
          // accessor could by default extend `this._accessor`:
          // accessor = _.extend({}, this._accessor, accessor);

          options = options || {};

          // Sanity-check that all provided options are supported
          var unsupportedProvidedOptions = _.difference(_.keys(options),
            [ 'annotateErrHasReadPermission', 'requiredFirstAuthorizedAuthorizationLevel' ]);
          if (unsupportedProvidedOptions.length) {
            throw new BookshelfPermissionsPluginSanityError(
              'Unsupported options passed to `checkHasPermission`: ' + unsupportedProvidedOptions.join(', '));
          }

          return this._getFirstAuthorizedAuthorizationLevelForPermission(permission, accessor)
            .bind(this)
            .then(function(result) {
              var err;
              if (result.isAuthorized) {
                // Check that accessor has permission at the required first authorized authorization
                // level, if that option has been specified.
                if (options.requiredFirstAuthorizedAuthorizationLevel) {
                  if (result.authorizationLevelName === options.requiredFirstAuthorizedAuthorizationLevel) {
                    return this;
                  } else {
                    err = new DefaultDoesNotHavePermissionError('Forbidden: has permission but not at required authorization level.');
                  }
                } else {
                  return this;
                }
              } else {
                err = result.authorizationFeatureEvaluatorError ||
                  new DefaultDoesNotHavePermissionError('Forbidden: lacks permission.');
              }

              // Annotate err with `accessorHasReadPermission` if that option has
              // been specified
              if (options.annotateErrHasReadPermission) {
                // If original `permission` is 'read', we don't need to evaluate
                // that permission again.
                if (permission === 'read') {
                  err.accessorHasReadPermission = false;
                  throw err;
                } else {
                  return this._getFirstAuthorizedAuthorizationLevelForPermission(
                    'read', accessor
                  )
                  .then(function(disavowalPermissionResult) {
                    err.accessorHasReadPermission = disavowalPermissionResult.isAuthorized;
                    throw err;
                  });
                }
              } else {
                throw err;
              }
            });
        }),

        roleDeterminer: useWithBookshelfAdvancedSerializationPlugin ?
          function(accessor) {
            var permission = this.permissions.serialize ? 'serialize' : 'read';
            return this._getFirstAuthorizedAuthorizationLevelForPermission(permission, accessor)
              .then(function(result) {
                return result.isAuthorized ?
                  result.authorizationLevelName :
                  'unauthorized';
                  // TODO How to make `'unauthorized'` a default role for all models,
                  // whose visible properties are an empty list?
              });
          } : undefined

      });

      Bookshelf.Collection = Bookshelf.Collection.extend({
        checkHasPermission: function(permission, accessor, options) {
          return BluebirdPromise.map(this.models, function(model) {
            return model.checkHasPermission(permission, accessor, options);
          });
        }
      })
    };
  }
};
