# Notices

`@geniuskey/bpmn-flow` is MIT licensed (see LICENSE).

The JavaScript in `dist/` contains only BPMN Flow's own code; its runtime
dependencies are installed from npm under their own licenses:

| Package     | License                                                     |
| ----------- | ----------------------------------------------------------- |
| bpmn-moddle | MIT                                                         |
| diagram-js  | MIT (Camunda Services GmbH)                                 |
| didi        | MIT                                                         |
| tiny-svg    | MIT                                                         |
| elkjs       | EPL-2.0 OR GPL-3.0-or-later; used under EPL-2.0, unmodified |

elkjs source code: https://github.com/kieler/elkjs

`dist/style.css` includes the stylesheet of diagram-js
(`diagram-js/assets/diagram-js.css`, which contains tokens from `@bpmn-io/theme`):

> The MIT License (MIT)
>
> Copyright (c) 2014-present Camunda Services GmbH
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of
> this software and associated documentation files (the "Software"), to deal in
> the Software without restriction, including without limitation the rights to
> use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
> the Software, and to permit persons to whom the Software is furnished to do so,
> subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
> FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
> COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
> IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
> CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
