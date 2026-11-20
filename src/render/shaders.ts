/**
 * WebGL2 着色器源码与编译工具。
 * 场景使用简单的方向光 + 常量环境光, 影子以投影几何单独绘制。
 */

export const SCENE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
out vec3 vNormal;
out vec3 vWorldPos;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorldPos = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uProj * uView * world;
}`;

export const SCENE_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorldPos;
uniform vec3 uColor;
uniform vec3 uSunDir;
uniform float uAlpha;
uniform int uUnlit;
out vec4 frag;
void main() {
  vec3 base = uColor;
  if (uUnlit == 1) {
    frag = vec4(base, uAlpha);
    return;
  }
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uSunDir)), 0.0);
  vec3 lit = base * (0.35 + 0.75 * diff);
  frag = vec4(lit, uAlpha);
}`;

/** 投影阴影专用着色器: 纯半透明深色, 无光照 */
export const SHADOW_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPosition;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
void main() {
  gl_Position = uProj * uView * uModel * vec4(aPosition, 1.0);
}`;

export const SHADOW_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 frag;
void main() { frag = uColor; }`;

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('无法创建 shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('shader 编译失败: ' + log);
  }
  return sh;
}

export function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new Error('无法创建 program');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error('program 链接失败: ' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}
