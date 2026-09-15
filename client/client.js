window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-memoknow',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var CSS = '.dmk-settings-frame{display:block;width:100%;height:calc(100vh - 220px);min-height:560px;border:0;background:transparent}'

    function installStyles() {
      if (document.querySelector('style[data-plugin-css="dsh-memoknow"]')) return
      var style = document.createElement('style')
      style.dataset.pluginCss = 'dsh-memoknow'
      style.textContent = CSS
      document.head.appendChild(style)
      return function () { style.remove() }
    }

    function MemoKnowSettings() {
      return React.createElement('iframe', {
        className: 'dmk-settings-frame',
        src: '/_dsh/memoknow?embedded=1',
        title: 'MemoKnow settings',
      })
    }

    exports.inject = ['slots']
    exports.apply = function (ctx) {
      ctx.effect(installStyles, 'dsh-memoknow: styles')
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'dsh-memoknow',
          order: 100,
          label: function () { return 'MemoKnow' },
        }, MemoKnowSettings)
      })
    }
    return module.exports
  },
})
