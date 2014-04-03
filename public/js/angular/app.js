'use strict';

angular.module('ezPAARSE', [
  'ui.router',
  'ngCookies',
  'btford.socket-io',
  'ezPAARSE.services',
  'ezPAARSE.main-controllers',
  'ezPAARSE.form-controllers',
  'ezPAARSE.anonymous-controllers',
  'ezPAARSE.directives',
  'ezPAARSE.filters'
]).config(function ($stateProvider, $locationProvider, $urlRouterProvider) {
  $locationProvider.html5Mode(true);
  $urlRouterProvider.otherwise('/form');

  var login = {
    name: 'login',
    url: '/login',
    templateUrl: '/partials/login'
  };
  var home = {
    name: 'home',
    url: '/',
    templateUrl: '/partials/index',
    abstract: true,
    resolve: {
      /**
       * When accessing any page, check that a user is authenticated.
       * If not, request the session from the server.
       * Redirect to login in case of failure.
       */
      userSession: function (userService, $state, $http, $q) {
        if (userService.isAuthenticated()) { return; }

        var promise = $q.defer();
        $http.get('/session').success(function (user) {
          if (user) {
            userService.login(user.username, user.group);
          }
          promise.resolve();
        }).error(function () {
          promise.resolve();
        });

        return promise;
      }
    }
  };

  var checkAuth = function ($state, userService) {
    if (!userService.isAuthenticated()) { $state.go('login'); }
  };

  var process = {
    name: 'process',
    url: 'process',
    parent: home,
    templateUrl: '/partials/process',
    onEnter: checkAuth
  };
  var form = {
    name: 'form',
    url: 'form',
    parent: home,
    templateUrl: '/partials/form',
    onEnter: checkAuth
  };
  var report = {
    name: 'report',
    url: 'report/:jobID',
    parent: home,
    templateUrl: '/partials/report'
  };

  $stateProvider.state(login);
  $stateProvider.state(home);
  $stateProvider.state(process);
  $stateProvider.state(form);
  $stateProvider.state(report);

});
// .factory('loginInterceptor', function ($q, $injector) {
//   // Redirect to login page if a request gets a 401
//   return {
//     responseError: function(rejection) {
//       if (rejection.status === 401) {
//         $injector.get('$state').transitionTo('login');
//       }
//       return $q.reject(rejection);
//      }
//    };
// }).config(function ($httpProvider) {
//   $httpProvider.interceptors.push('loginInterceptor');
// })