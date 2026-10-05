import {readFileSync, existsSync} from 'node:fs';
import {createRequire, Module} from 'node:module';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));

// Execute the real TypeScript with narrow adapters mocked at module boundaries.
// Each loader owns its module cache, so route admission state is isolated.
export function typescriptLoader(mocks = {}) {
  const cache = new Map();
  function load(path) {
    let filename = resolve(root, path);
    if (!existsSync(filename)) filename += '.ts';
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiledModule = new Module(filename);
    compiledModule.filename = filename;
    cache.set(filename, compiledModule);
    compiledModule.require = (name) => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/')) return load(name.slice(2));
      if (name.startsWith('.')) return load(resolve(dirname(filename), name));
      return require(name);
    };
    const {outputText} = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}
    });
    compiledModule._compile(outputText, filename);
    return compiledModule.exports;
  }
  return load;
}
