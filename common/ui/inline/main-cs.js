/**
 * Mailvelope - secure email with OpenPGP encryption for Webmail
 * Copyright (C) 2012  Thomas Oberndörfer
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License version 3
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var constant = constant || (function() {
  var local = {
    FRAME_STATUS: '1',
    // frame status
    FRAME_ATTACHED: '2',
    FRAME_DETACHED: '3',
    // key for reference to frame object
    FRAME_OBJ: '4',
    // scan status
    SCAN_ON: '5',
    SCAN_OFF: '6',
    // marker for dynamically created iframes
    DYN_IFRAME: '7',
    IFRAME_OBJ: '8',
    // armor header type
    PGP_MESSAGE: '9',
    PGP_SIGNATURE: '10',
    PGP_PUBLIC_KEY: '11',
    PGP_PRIVATE_KEY: '12'
  }
  Object.freeze(local);
  return local;
}());

(document.mveloControl || function() {
  
  var interval = 2500; // ms
  var regex = /END\sPGP/;
  var status = constant.SCAN_ON;
  var minEditHeight = 100;
  var contextTarget = null;
  var tabid = 0;
  
  function init() {
    getTabid();
    initScanInterval(interval);
    addMessageListener();
    initContextMenu();
  }

  function getTabid() {
    if (mvelo.crx) {
      mvelo.extension.sendMessage({event: "get-tabid"}, function(response) {
        tabid = response.tabid;
      });
    }
  }
  
  function initScanInterval(interval) {
    window.setInterval(function() {
      //console.log('inside cs: ', document.location.host;
      if (status === constant.SCAN_ON) {
        // find armored PGP text
        var pgpTag = findPGPTag(regex);
        if (pgpTag.length !== 0) {
          attachDecryptFrame(pgpTag);
        }
        // find editable content
        var editable = findEditable();
        if (editable.length !== 0) {
          attachEncryptFrame(editable);
        }
      }
    }, interval);
  }
  
  /**
   * find text nodes in DOM that match certain pattern
   * @param regex
   * @return $([nodes])
   */
  function findPGPTag(regex) {
    var treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { 
      acceptNode: function(node) {
          if (node.parentNode.tagName !== 'SCRIPT' && regex.test(node.textContent)) {
            return NodeFilter.FILTER_ACCEPT; 
          } else {
            return NodeFilter.FILTER_REJECT; 
          }
        } 
      },  
      false  
    );  
    var nodeList = [];

    while(treeWalker.nextNode()) nodeList.push(treeWalker.currentNode);

    // filter out hidden elements
    nodeList = $(nodeList).filter(function() {
      var element = $(this);
      // visibility check does not work on text nodes
      return element.parent().is(':visible')
             // no elements within editable elements
             && element.parents('[contenteditable], textarea').length === 0
             && !element.parent().is('body');
    });

    return nodeList; 
  }

  function findEditable() {
    // find textareas and elements with contenteditable attribute, filter out <body>
    var editable = $('[contenteditable], textarea').filter(':visible').not('body');
    var iframes = $('iframe').filter(':visible');
    // find dynamically created iframes where src is not set
    var dynFrames = iframes.filter(function() {
      var src = $(this).attr('src');
      return src === undefined ||
             src === '' ||
             /^javascript.*/.test(src) ||
             /^about.*/.test(src);
    });
    // find editable elements inside dynamic iframe (content script is not injected here)
    dynFrames.each(function() {
      var content = $(this).contents();
      // set event handler for contextmenu
      content.find('body').off("contextmenu").on("contextmenu", onContextMenu)
      // mark body as 'inside iframe'
                          .data(constant.DYN_IFRAME, true)
      // add iframe element
                          .data(constant.IFRAME_OBJ, $(this));
      // document of iframe in design mode or contenteditable set on the body
      if (content.attr('designMode') === 'on' || content.find('body[contenteditable]').length !== 0) {
        // add iframe to editable elements
        editable = editable.add($(this));
      } else {
        // editable elements inside iframe
        var editblElem = content.find('[contenteditable], textarea').filter(':visible');
        editable = editable.add(editblElem);
      }
    });
    // find iframes from same origin with a contenteditable body (content script is injected, but encrypt frame needs to be attached to outer iframe)
    var anchor = $('<a/>');
    var editableBody = iframes.not(dynFrames).filter(function() {
      var frame = $(this);
      // only for iframes from same host
      if (anchor.attr('href', frame.attr('src')).prop('hostname') === document.location.hostname) {
        try {
          var content = frame.contents();
          if (content.attr('designMode') === 'on' || content.find('body[contenteditable]').length !== 0) {
            // set event handler for contextmenu
            content.find('body').off("contextmenu").on("contextmenu", onContextMenu);
            // mark body as 'inside iframe'
            content.find('body').data(constant.IFRAME_OBJ, frame);
            return true;
          } else {
            return false;
          }
        } catch (e) {
          return false;
        };
      }
    });
    editable = editable.add(editableBody);
    // filter out elements below a certain height limit
    editable = editable.filter(function() {
      return $(this).height() > minEditHeight;
    });
    return editable;
  }
  
  function attachDecryptFrame(element) {
    // check status of PGP tags
    var newObj = element.filter(function() {
      return !DecryptFrame.isAttached($(this));
    });
    // create new decrypt frames for new discovered PGP tags
    newObj.each(function(index, element) {
      var dFrame = new DecryptFrame();
      dFrame.attachTo($(element), tabid);
    });
  }
  
  /**
   * attach encrypt frame to element
   * @param  {$} element
   * @param  {boolean} expanded state of frame
   */
  function attachEncryptFrame(element, expanded) {
    // check status of elements
    var newObj = element.filter(function() {
      if (expanded) {
        // filter out only attached frames
        if (element.data(constant.FRAME_STATUS) === constant.FRAME_ATTACHED) {
          // trigger expand state of attached frames
          element.data(constant.FRAME_OBJ).showEncryptDialog();
          return false;
        } else {
          return true;
        }
      } else {
        // filter out attached and detached frames
        return !EncryptFrame.isAttached($(this));
      }
    });
    // create new encrypt frames for new discovered editable fields
    newObj.each(function(index, element) {
      var eFrame = new EncryptFrame();
      eFrame.attachTo($(element), expanded, tabid);
    });
  }
  
  function addMessageListener() {
    mvelo.extension.onMessage.addListener(
      function(request) {
        //console.log('contentscript: %s onRequest: %o', document.location.toString(), request);
        if (request.event === undefined) return;
        switch (request.event) {
          case 'on':
            status = constant.SCAN_ON;
            break;
          case 'off':
            status = constant.SCAN_OFF;
            break;
          case 'context-encrypt':
            if (contextTarget !== null) {
              attachEncryptFrame(contextTarget, true);
              contextTarget = null;
            }
            break;  
          default:
          console.log('unknown scan status');
        }
      }
    );
  }

  function initContextMenu() {
    // set handler
    $("body").on("contextmenu", onContextMenu);
  }

  function onContextMenu(e) {
    //console.log(e.target);
    var target = $(e.target);
    // find editable descendants or ascendants
    var element = target.find('[contenteditable], textarea');
    if (element.length === 0) {
      element = target.closest('[contenteditable], textarea');
    }
    if (element.length !== 0 && !element.is('body')) {
      if (element.height() > minEditHeight) {
        contextTarget = element;
      } else {
        contextTarget = null;
      }
      return;
    }
    // inside dynamic iframe or iframes from same origin with a contenteditable body
    element = target.closest('body');
    // get outer iframe
    var iframeObj = element.data(constant.IFRAME_OBJ);
    if (iframeObj !== undefined) {
      // target set to outer iframe
      contextTarget = iframeObj;
      return; 
    }
    // no suitable element found
    contextTarget = null;
  }
  
  document.mveloControl = true;
  init();

}());
