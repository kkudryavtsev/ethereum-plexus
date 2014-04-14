ETHERSALE_URL = "http://localhost:5000";

var ethereum = angular.module('ethereum', []);

ethereum.config([
  '$compileProvider',
  function($compileProvider) {
    $compileProvider.aHrefSanitizationWhitelist(/^\s*(https?|mailto|bitcoin):/);
  }
]);

ethereum.controller('PurchaseCtrl', ['Purchase', 'DownloadDataURI', '$scope', function(Purchase, DownloadDataURI, $scope) {
  $scope.requiredEntropyLength = 50;
  window.wscope = $scope;
  $scope.entropy = '';
  $scope.didPushTx = false;
  $scope.debug = '(Debug output)';
  $scope.email = 'asdf@ asdf.asdf'; // TODO remove debug
  $scope.email_repeat = 'asdf@ asdf.asdf'; // TODO remove debug
  $scope.password = 'asd'; // TODO remove debug
  $scope.password_repeat = 'asd'; // TODO remove debug

  $scope.mkQRCode = function(address) {
    // $scope.qrcode = new QRCode("qr_deposit_address", { // reaching back into the DOM is bad
    //   text: 'bitcoin:' + address,
    //   width: 250,
    //   height: 250,
    //   colorDark: "#000000",
    //   colorLight: "#ffffff",
    //   correctLevel: QRCode.CorrectLevel.H
    // });

    //unfortunately had to reserve to this hack, as the damn qrcode refuses to render otherwise
    //not sure why, but I'd blame liquid-slider for this
    (window.showQrCode || function(){})(address);
  };

  window.onmousemove = function(e) { 
    // only work when the first steps are done
    if (!$scope.email_repeat || ($scope.password != $scope.password_repeat)) return;
    // only work if a btcAddress doesn' t already exist
    if (!$scope.btcAddress) {

      var roundSeed = '' + e.x + e.y + new Date().getTime() + Math.random();

      Bitcoin.Crypto.SHA256(roundSeed, {
        asBytes: true
      }).slice(0, 3).map(function(c) {
        $scope.entropy += 'abcdefghijklmnopqrstuvwxyz234567' [c % 32];
      });
      
      if ($scope.entropy.length > $scope.requiredEntropyLength && !$scope.wallet) {
        $scope.wallet = 1;
        //$scope.entropy = 'qwe'; // TODO remove debug;
        console.log('generating wallet'); // Add loading thingy
        $scope.pwkey = pbkdf2($scope.password);
        console.log(1);
        $scope.wallet = genwallet($scope.entropy, $scope.pwkey, $scope.email);
        console.log(2);
        $scope.backup = mkbackup($scope.wallet, $scope.pwkey);
        console.log(3);
        $scope.mkQRCode($scope.wallet.btcaddr);

        $scope.debug = 'entropy: ' + $scope.entropy + "\nbtcaddr: " + $scope.wallet.btcaddr;
        if (!$scope.$$phase) $scope.$apply();

        (window.onWalletReady || function(){})();
      }
    }
  };

  var timerUnspent = setInterval(function() {

    if (!$scope.wallet || !$scope.wallet.btcaddr) return;
    //$scope.status = 'Connecting...' //need to force drawing of this first time only
    Purchase.getUnspent($scope.wallet.btcaddr, function(e, unspent) {
      if (e || (!e && !unspent)) {
        return $scope.status = e || 'Error connecting, please try later.';
      }
      var tx = finalize($scope.wallet, unspent, $scope.pwkey);

      if (!tx) {
        $scope.status = 'Waiting for deposit...';
      } else {
        var data = {
          'tx': tx,
          'email': $scope.email,
          'emailjson': $scope.backup
        };
        $scope.didPushTx = true;

        Purchase.sendTx(data, function(e, r) {
          if (e) {
            $scope.error = e;
            return e;
          }
          $scope.pushtxsuccess = true;
          doc = JSON.stringify($scope.wallet);
          $scope.debug = doc;
          clearInterval(timerUnspent);
          $scope.status = 'Transaction complete!\n\nDownload your wallet now then check your email for a backup.';

          (window.onTransactionComplete || function(){})(
            'data:application/octet-stream;base64,' + Base64.encode(doc)
          );
          var downloadLinkEle = angular.element('#downloadLink');
          downloadLinkEle.attr('href', 'data:application/octet-stream;base64,' + Base64.encode(doc));
        });
      }
    });
  }, 3000);

  $scope.downloadWallet = function() {
    var downloadLinkEle = angular.element('#downloadLink');

    DownloadDataURI({
      filename: downloadLinkEle.attr('download'),
      data: downloadLinkEle.attr('href')
    });
  };
}]);

// allows for form validation based on one element matching another
ethereum.directive('match', ['$parse', function($parse) {
  return {
    require: 'ngModel',
    restrict: 'A',
    link: function(scope, elem, attrs, ctrl) {
      scope.$watch(function() {
        return (ctrl.$pristine && angular.isUndefined(ctrl.$modelValue)) || $parse(attrs.match)(scope) === ctrl.$modelValue;
      }, function(currentValue) {
        ctrl.$setValidity('match', currentValue);
      });
    }
  };
}]);

// password meter
ethereum.directive('checkStrength', function() {
  return {
    replace: false,
    restrict: 'EACM',
    scope: {
      model: '=checkStrength'
    },
    link: function(scope, element, attrs) {

      var strength = {
        colors: ['#F00', '#F90', '#FF0', '#9F0', '#0F0'],
        // TODO this strenght algorithm needs improvement
        measureStrength: function(p) {
          var _force = 0;
          var _regex = /[$-/:-?{-~!"^_`\[\]]/g; //" (commented quote to fix highlighting in Sublime Text)

          var _lowerLetters = /[a-z]+/.test(p);
          var _upperLetters = /[A-Z]+/.test(p);
          var _numbers = /[0-9]+/.test(p);
          var _symbols = _regex.test(p);

          var _flags = [_lowerLetters, _upperLetters, _numbers, _symbols];
          var _passedMatches = _flags.map(function(el) {
            return el === true;
          });
          _matches = 0;
          for (var i = 0; i < _passedMatches.length; i++) {
            if (_passedMatches[i])
              _matches += 1;
          }
          _force += 2 * p.length + ((p.length >= 10) ? 1 : 0);
          _force += _matches * 10;

          // penality (short password)
          _force = (p.length <= 6) ? Math.min(_force, 10) : _force;

          // penality (poor variety of characters)
          _force = (_matches == 1) ? Math.min(_force, 10) : _force;
          _force = (_matches == 2) ? Math.min(_force, 20) : _force;
          _force = (_matches == 3) ? Math.min(_force, 40) : _force;

          return _force;

        },
        getColor: function(s) {

          var idx = 0;
          if (s <= 10) {
            idx = 0;
          } else if (s <= 20) {
            idx = 1;
          } else if (s <= 30) {
            idx = 2;
          } else if (s <= 40) {
            idx = 3;
          } else {
            idx = 4;
          }

          return {
            idx: idx + 1,
            col: this.colors[idx]
          };

        }
      };

      scope.$watch('model', function(newValue, oldValue) {
        if (!newValue || newValue === '') {
          element.css({
            "display": "none"
          });
        } else {
          var c = strength.getColor(strength.measureStrength(newValue));
          element.css({
            "display": "inline"
          });
          var kids = element.children('li');

          for (var i = 0; i < kids.length; i++) {
            if (i < c.idx)
              kids[i].style.backgroundColor = c.col;
            else
              kids[i].style.backgroundColor = '#777';
          }
        }
      });

    },
    template: '<li class="point"></li><li class="point"></li><li class="point"></li><li class="point"></li><li class="point"></li>'
  };
});

ethereum.factory('DownloadDataURI', ['$http', function($http) {

  return function(options) {
    if (!options) {
      return;
    }
    if (!$.isPlainObject(options)) {
      options = {
        data: options
      };
    }
    if (!navigator.userAgent.match(/webkit/i)) {
      return;
    }

    if (!options.filename) {
      options.filename = "download." + options.data.split(",")[0].split(";")[0].substring(5).split("/")[1];
    }

    if (!options.url) {
      (options.url = "/download");
    }

    $form = $('<form method="post" action="' + options.url +
              '" style="display:none"' +
              ' class="ng-non-bindable">' +
              '<input type="hidden" name="filename" value="' +
              options.filename + '"/><input type="hidden" name="data" value="' +
              options.data + '"/></form>');
    $form.appendTo($('body')).submit().remove();
  };
}]);


ethereum.factory('Purchase', ['$http', function($http) {
  return {
    getUnspent: function(address, cb) {
      $http.get(ETHERSALE_URL +  '/unspent/' + address)
        .success(function(s) {
          cb(null, s)
        })
        .error(function(e) {
          cb(e.status)
        })
    },
    sendTx: function(data, cb) {
      $http.post(ETHERSALE_URL + '/pushtx', data)
        .success(function(s) {
          cb(null, s)
        })
        .error(function(e) {
          cb(e.status)
        })
    }
  }
}]);
