# bookshelf-permissions

[![npm version](https://img.shields.io/npm/v/bookshelf-permissions.svg?style=flat)](https://www.npmjs.com/package/bookshelf-permissions)

## Description

This module is a plugin for [Bookshelf.js](https://github.com/tgriesser/bookshelf), to control CRUD access to Bookshelf models and collections based on permissions.

It optionally integrates well with [bookshelf-advanced-serialization](https://github.com/sequiturs/bookshelf-advanced-serialization).

## How to use

### Overview

To use this plugin to control access to a model or collection of models, you need to define a `permissions` object and an `_authorizationFeatures` object on the model. Then, to check if an `accessor` has a certain permission on the model/collection, you call `modelOrCollection.checkHasPermission(permissionName, accessor, options)`.

- `permissions` maps a permission name to a list of authorization level objects. An authorization level object consists of an `authorizationLevelName` and a list of `requiredAuthorizationFeatures` which the accessor who wants to be granted the permission must have in order to be granted the permission at that authorization level. The list of authorization level objects is evaluated in order, and the first one for which the accessor has all the required authorization features is the one which grants the accessor permission. If there is no authorization level for which the accessor has all required features, the accessor lacks the permission and an error is thrown.
- `_authorizationFeatures` maps an authorization feature name to an authorization feature object. An authorization feature object consists of a list of `evaluatorArgumentsAccessorKeys` and an `evaluator` function. An authorization feature is evaluated by invoking `evaluator` with the arguments specified by `evaluatorArgumentsAccessorKeys`, where the strings in `evaluatorArgumentsAccessorKeys` identify keys in the `accessor` object provided in `modelOrCollection.checkHasPermission(permissionName, accessor, options)`. The accessor is considered to have the authorization feature if and only if `evaluator` returns a truthy non-Promise value or a Promise resolving to a truthy value.

### Example

```JavaScript
npm install bookshelf-permissions
```

then

```JavaScript
// bookshelf.js

var permissions = require('bookshelf-permissions');

var knex = require('knex')({ ... });
var bookshelf = require('bookshelf')(knex);

bookshelf.plugin(permissions.configure({

  useWithBookshelfAdvancedSerializationPlugin: true, // When `true`, this option
  // automatically defines a `roleDeterminer` method that is used by the
  // bookshelf-advanced-serialization plugin when serializing. The `roleDeterminer`
  // uses the model's definition of a 'serialize' (or 'read') permission, returning
  // the value of `authorizationLevelName`.

  DefaultDoesNotHavePermissionError: Error // This option allows you to specify
  // the default error class which the `.checkHasPermission(permission, accessor)`
  // throws if the accessor lacks the permission.

}));

module.exports = bookshelf;
```

```JavaScript
// Group.js

var BluebirdPromise = require('bluebird');
var bookshelf = require('./bookshelf.js');

var relationPromise = function(model, relationName) {
  return model.relations[relationName] ?
    BluebirdPromise.resolve(model.related(relationName)) :
    model.load(relationName);
};

var Group = bookshelf.Model.extend({
  tableName: 'groups',
  _authorizationFeatures: {
    userIsAdmin: {
      evaluatorArgumentsAccessorKeys: [ 'user' ],
      evaluator: function(user) {
        return relationPromise(this, 'admins')
          .then(function(adminsCollection) {
            return !!adminsCollection.get(user.id);
          });
      }
    },
    userIsMember: {
      evaluatorArgumentsAccessorKeys: [ 'user' ],
      evaluator: function(user) {
        return relationPromise(this, 'members')
          .then(function(membersCollection) {
            return !!membersCollection.get(user.id);
          });
      }
    },
    userIsSuperSpecial: {
      evaluatorArgumentsAccessorKeys: [ 'user' ],
      evaluator: function(user) {
        return user.id === 'SUPER_SPECIAL';
      }
    }
  },
  permissions: {
    read: [
      {
        authorizationLevelName: 'admin',
        requiredAuthorizationFeatures: [
          'userIsAdmin'
        ]
      },
      {
        authorizationLevelName: 'member',
        requiredAuthorizationFeatures: [
          'userIsMember'
        ]
      }
    ],
    inviteUser: [
      {
        authorizationLevelName: 'default',
        requiredAuthorizationFeatures: [
          'userIsAdmin'
        ]
      }
    ],
    doSomethingElse: [
      {
        authorizationLevelName: 'default',
        requiredAuthorizationFeatures: [
          'userIsMember',
          'userIsSuperSpecial'
        ]
      }
    ]
  },
  rolesToVisibleProperties: {
    admin:        [ 'admins', 'members', 'invited_users' ],
    member:       [ 'admins', 'members' ],
    unauthorized: []
  },

  admins: function() {
    return this.belongsToMany('User', 'group_admins', 'group_id', 'user_id');
  },
  members: function() {
    return this.belongsToMany('User', 'group_members', 'group_id', 'user_id');
  },
  invited_users: function() {
    return this.belongsToMany('User', 'group_invited_users', 'group_id', 'user_id');
  }
}, {});

module.exports = bookshelf.model('Group', Group);
```

```JavaScript
// app.js

var express = require('express');
var bookshelf = require('./bookshelf.js');

require('./Group.js');

var app = express();

app.get('/groups/:id', function(req, res) {
  var accessor = { user: req.user };
  bookshelf.model('Group')
    .forge({ id: req.params.id })
    .fetch()
    .then(function(group) {
      return group.checkHasPermission('read', accessor)
    })
    .then(function(group) {
      var toJSONOptions = { accessor: accessor };
      return group.toJSON(toJSONOptions); // Passing `accessor` option
      // is necessary here because we specified the
      // `useWithBookshelfAdvancedSerializationPlugin: true` plugin option, so
      // `.toJSON()` will end up performing its own invocation of
      // `group.checkHasPermission('read', toJSONOptions.accessor)`.
    })
    .then(function(data) {
      res.status(200).send(data);
    });
});

app.listen(8080, function () {
  console.log('Server listening on http://localhost:8080, Ctrl+C to stop');
});

```

## Roadmap

This plugin is still in development and APIs are subject to change. Unit tests and better documentation are planned for a v1.0.0 release. This plugin is currently used in production by [Sequiturs](https://sequiturs.com), however, and its functionality is tested thoroughly via integration testing of the Sequiturs application.
