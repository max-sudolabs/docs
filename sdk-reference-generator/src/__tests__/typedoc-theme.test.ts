import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { processPageContents, joinTypeExpressions } = require('../../configs/typedoc-theme.cjs');

// processPageContents strips the first 6 lines of every page
const PREAMBLE = 'stripped\n'.repeat(6);

function fenceLines(text: string): string[] {
  return text.split('\n').filter((line) => line.startsWith('```'));
}

describe('processPageContents', () => {
  it('removes link-style Overrides sections', () => {
    const input =
      PREAMBLE +
      `###### Returns

\`TimeoutError\`

###### Overrides

[\`SandboxError\`](errors.md#sandboxerror).[\`constructor\`](errors.md#constructors)

***
`;

    const output = processPageContents(input);

    expect(output).not.toContain('Overrides');
    expect(output).not.toContain('SandboxError');
    expect(output).toContain('`TimeoutError`');
    expect(output).toContain('***');
  });

  it('removes code-block-style Overrides sections without orphaning fences', () => {
    const input =
      PREAMBLE +
      `###### Returns

\`AuthenticationError\`

###### Overrides

\`\`\`ts
Error.constructor
\`\`\`

***

### BuildError
`;

    const output = processPageContents(input);

    expect(output).not.toContain('Overrides');
    expect(output).not.toContain('Error.constructor');
    expect(fenceLines(output)).toHaveLength(0);
    expect(output).toContain('### BuildError');
  });

  it('removes code-block-style Inherited from sections', () => {
    const input =
      PREAMBLE +
      `###### Inherited from

\`\`\`ts
Error.message
\`\`\`

***
`;

    const output = processPageContents(input);

    expect(output).not.toContain('Inherited from');
    expect(fenceLines(output)).toHaveLength(0);
  });

  it('removes Extends sections but keeps Extended by', () => {
    const input =
      PREAMBLE +
      `#### Extends

- \`SandboxError\`

#### Extended by

- \`GitAuthError\`

#### Constructors
`;

    const output = processPageContents(input);

    expect(output).not.toContain('#### Extends\n');
    expect(output).toContain('#### Extended by');
    expect(output).toContain('- `GitAuthError`');
    expect(output).toContain('#### Constructors');
  });

  it('keeps fences balanced across a page mixing both section styles', () => {
    const input =
      PREAMBLE +
      `### AuthenticationError

#### Constructors

\`\`\`ts
new AuthenticationError(message: string): AuthenticationError
\`\`\`

###### Returns

\`AuthenticationError\`

###### Overrides

\`\`\`ts
Error.constructor
\`\`\`

***

### TimeoutError

#### Constructors

\`\`\`ts
new TimeoutError(message: string): TimeoutError
\`\`\`

###### Overrides

[\`SandboxError\`](errors.md#sandboxerror).[\`constructor\`](errors.md#constructors)

***
`;

    const output = processPageContents(input);

    expect(fenceLines(output)).toHaveLength(4);
    expect(output).toContain('new AuthenticationError');
    expect(output).toContain('new TimeoutError');
    expect(output).not.toContain('Overrides');
  });
});

describe('Constructs sections', () => {
  it('removes the section with its stray closing fence', () => {
    const input =
      PREAMBLE +
      `###### Example

\`\`\`ts
const sandbox = await Sandbox.create()
\`\`\`

###### Constructs

Sandbox

\`\`\`

###### Call Signature

\`\`\`ts
create(opts?): Promise<Sandbox>
\`\`\`
`;

    const output = processPageContents(input);

    expect(output).not.toContain('Constructs');
    expect(fenceLines(output)).toHaveLength(4);
    expect(output).toContain('###### Call Signature');
  });
});

describe('stray fences', () => {
  it('drops a closing fence left after a Deprecated note', () => {
    const input =
      PREAMBLE +
      `###### Deprecated

Use SandboxApi.pause instead.

\`\`\`

### connect()

\`\`\`ts
connect(): Promise<Sandbox>
\`\`\`
`;

    const output = processPageContents(input);

    expect(fenceLines(output)).toHaveLength(2);
    expect(output).toContain('### connect()');
  });

  it('keeps a bare fence that opens a real code block', () => {
    const input = '```\nnpm i e2b\n```\n\n### next';
    expect(require('../../configs/typedoc-theme.cjs').removeStrayFences(input)).toBe(input);
  });
});

describe('joinTypeExpressions', () => {
  it('moves the optional marker into the parameter name', () => {
    expect(joinTypeExpressions('| `stackTrace`? | `string` |')).toBe(
      '| `stackTrace?` | `string` |'
    );
  });

  it('keeps a leading property anchor', () => {
    expect(
      joinTypeExpressions('| <a id="gid"></a> `gid`? | `number` | Group ID of the file or directory. |')
    ).toBe('| <a id="gid"></a> `gid?` | `number` | Group ID of the file or directory. |');
  });

  it('joins a generic type into one code span', () => {
    expect(joinTypeExpressions('`Promise`\\<`boolean`\\>')).toBe('`Promise<boolean>`');
    expect(
      joinTypeExpressions('`Promise`\\<`ReadableStream`\\<`Uint8Array`\\<`ArrayBufferLike`\\>\\>\\>')
    ).toBe('`Promise<ReadableStream<Uint8Array<ArrayBufferLike>>>`');
    expect(joinTypeExpressions('`Promise`\\<`WriteInfo`[]\\>')).toBe('`Promise<WriteInfo[]>`');
  });

  it('keeps union pipes escaped inside table cells', () => {
    expect(
      joinTypeExpressions(
        '| `opts`? | `Pick`\\<`SandboxOpts`, `"requestTimeoutMs"` \\| `"signal"`\\> | connection options. |'
      )
    ).toBe('| `opts?` | `Pick<SandboxOpts, "requestTimeoutMs" \\| "signal">` | connection options. |');
  });

  it('drops the leading pipe of a union and joins function types', () => {
    expect(
      joinTypeExpressions('| `data` | \\| `string` \\| `Blob` \\| `ReadableStream`\\<`any`\\> | data |')
    ).toBe('| `data` | `string \\| Blob \\| ReadableStream<any>` | data |');
    expect(
      joinTypeExpressions('| `onEvent` | (`event`: `FilesystemEvent`) => `void` \\| `Promise`\\<`void`\\> | callback |')
    ).toBe('| `onEvent` | `(event: FilesystemEvent) => void \\| Promise<void>` | callback |');
  });

  it('joins italic type keywords', () => {
    expect(joinTypeExpressions('| `S` *extends* *typeof* `Sandbox` |')).toBe('| `S extends typeof Sandbox` |');
    expect(joinTypeExpressions('| <a id="sandbox"></a> `Sandbox` | `readonly` | *typeof* `Sandbox` | bound class |')).toBe(
      '| <a id="sandbox"></a> `Sandbox` | `readonly` | `typeof Sandbox` | bound class |'
    );
    expect(joinTypeExpressions('| `Template` | `CallableTemplate`\\<*typeof* `TemplateBase`\\> | builder |')).toBe(
      '| `Template` | `CallableTemplate<typeof TemplateBase>` | builder |'
    );
  });

  it('leaves prose, plain code lists, single spans and fenced code alone', () => {
    const untouched = [
      '| `envs` | `Record` | Environment variables, see `Sandbox`? |',
      'Did you set `E2B_API_KEY`?',
      '`a`, `b`',
      '| `message` | `string` |',
      '```ts\nfoo(`a`?)\n```',
    ];
    for (const line of untouched) {
      expect(joinTypeExpressions(line)).toBe(line);
    }
  });
});

