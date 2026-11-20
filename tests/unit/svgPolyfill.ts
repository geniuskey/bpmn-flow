/**
 * Minimal SVG geometry for running diagram-js under jsdom (unit tests only):
 * jsdom has no layout, so boxes are empty and matrices are plain objects.
 */
class Matrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  multiply(m: Matrix): Matrix {
    const r = new Matrix();
    r.a = this.a * m.a + this.c * m.b;
    r.b = this.b * m.a + this.d * m.b;
    r.c = this.a * m.c + this.c * m.d;
    r.d = this.b * m.c + this.d * m.d;
    r.e = this.a * m.e + this.c * m.f + this.e;
    r.f = this.b * m.e + this.d * m.f + this.f;
    return r;
  }
  inverse(): Matrix {
    const det = this.a * this.d - this.b * this.c || 1;
    const r = new Matrix();
    r.a = this.d / det;
    r.b = -this.b / det;
    r.c = -this.c / det;
    r.d = this.a / det;
    r.e = (this.c * this.f - this.d * this.e) / det;
    r.f = (this.b * this.e - this.a * this.f) / det;
    return r;
  }
  translate(x: number, y: number): Matrix {
    const t = new Matrix();
    t.e = x;
    t.f = y;
    return this.multiply(t);
  }
  scale(s: number): Matrix {
    const t = new Matrix();
    t.a = s;
    t.d = s;
    return this.multiply(t);
  }
}

class Transform {
  type = 1;
  matrix = new Matrix();
  setMatrix(m: Matrix) {
    this.matrix = m;
  }
  setTranslate(x: number, y: number) {
    this.matrix = new Matrix().translate(x, y);
  }
  setRotate() {
    this.matrix = new Matrix();
  }
  setScale(sx: number) {
    this.matrix = new Matrix().scale(sx);
  }
}

class TransformList {
  items: Transform[] = [];
  get numberOfItems() {
    return this.items.length;
  }
  clear() {
    this.items = [];
  }
  appendItem(t: Transform) {
    this.items.push(t);
    return t;
  }
  initialize(t: Transform) {
    this.items = [t];
    return t;
  }
  getItem(i: number) {
    return this.items[i];
  }
  consolidate() {
    if (!this.items.length) return null;
    const t = new Transform();
    t.matrix = this.items.reduce((m, x) => m.multiply(x.matrix), new Matrix());
    this.items = [t];
    return t;
  }
  createSVGTransformFromMatrix(m: Matrix) {
    const t = new Transform();
    t.matrix = m;
    return t;
  }
}

export function installSvgPolyfill(): void {
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  if (proto.__bfPolyfill) return;
  proto.__bfPolyfill = true;
  const g = globalThis as Record<string, unknown>;
  g.SVGMatrix ??= Matrix;
  g.SVGTransform ??= Transform;
  proto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 });
  proto.getScreenCTM = () => new Matrix();
  proto.getCTM = () => new Matrix();
  Object.defineProperty(proto, 'transform', {
    get(this: { __t?: { baseVal: TransformList } }) {
      return (this.__t ??= { baseVal: new TransformList() });
    },
  });
  // A fixed-size viewport so the visible area has a center.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    get: () => 1000,
    configurable: true,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    get: () => 600,
    configurable: true,
  });
  const svgProto = (
    globalThis as unknown as { SVGSVGElement?: { prototype: Record<string, unknown> } }
  ).SVGSVGElement!.prototype;
  svgProto.createSVGMatrix = () => new Matrix();
  svgProto.createSVGTransform = () => new Transform();
  svgProto.createSVGTransformFromMatrix = (m: Matrix) => {
    const t = new Transform();
    t.matrix = m;
    return t;
  };
  svgProto.createSVGPoint = () => ({
    x: 0,
    y: 0,
    matrixTransform() {
      return { x: this.x, y: this.y };
    },
  });
}
