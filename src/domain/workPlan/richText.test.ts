import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentToEditorDoc,
  editorDocToContent,
  parseInlineMarks,
  serializeInlineSegments,
  stripInlineMarks,
  toEditableText,
  type EditorNode,
} from './richText';

test('parseInlineMarks: 표기 없는 글은 한 덩어리', () => {
  assert.deepEqual(parseInlineMarks('거래처 방문'), [{ text: '거래처 방문', marks: {} }]);
});

test('parseInlineMarks: 굵게·밑줄·취소선·형광펜·글자색', () => {
  assert.deepEqual(parseInlineMarks('a **굵게** b'), [
    { text: 'a ', marks: {} },
    { text: '굵게', marks: { bold: true } },
    { text: ' b', marks: {} },
  ]);
  assert.deepEqual(parseInlineMarks('++밑줄++~~취소~~==형광=={red}빨강{/}'), [
    { text: '밑줄', marks: { underline: true } },
    { text: '취소', marks: { strike: true } },
    { text: '형광', marks: { highlight: true } },
    { text: '빨강', marks: { color: 'red' } },
  ]);
});

test('parseInlineMarks: 중첩 서식', () => {
  assert.deepEqual(parseInlineMarks('**굵게 ~~둘다~~**'), [
    { text: '굵게 ', marks: { bold: true } },
    { text: '둘다', marks: { bold: true, strike: true } },
  ]);
});

test('parseInlineMarks: 닫히지 않은 표기와 모르는 색은 글자 그대로', () => {
  assert.deepEqual(parseInlineMarks('2**3 {pink}x{/}'), [{ text: '2**3 {pink}x{/}', marks: {} }]);
  assert.deepEqual(parseInlineMarks('****'), [{ text: '****', marks: {} }]);
});

test('serializeInlineSegments: parse 결과를 다시 같은 의미로 직렬화', () => {
  const src = '보고 **중요** ~~취소~~ {blue}==파랑 형광=={/} ++밑++';
  const segs = parseInlineMarks(src);
  assert.deepEqual(parseInlineMarks(serializeInlineSegments(segs)), segs);
});

test('stripInlineMarks: 표기 기호만 제거', () => {
  assert.equal(stripInlineMarks('**굵게** {red}빨강{/} 2**3'), '굵게 빨강 2**3');
});

const text = (t: string, marks?: EditorNode['marks']): EditorNode => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });

test('contentToEditorDoc: 체크리스트는 할 일 목록, 일반 줄은 문단, 빈 줄은 빈 문단', () => {
  const doc = contentToEditorDoc('메모 **중요**\n- [x] 완료 일\n- 할 일\n\n끝');
  assert.deepEqual(doc, {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [text('메모 '), text('중요', [{ type: 'bold' }])] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [text('완료 일')] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [text('할 일')] }] },
        ],
      },
      { type: 'paragraph' },
      { type: 'paragraph', content: [text('끝')] },
    ],
  });
});

test('contentToEditorDoc: 체크 메타(__c__)로 완료된 줄도 체크 상태를 유지', () => {
  const doc = contentToEditorDoc('- 첫째\n- 둘째\n__c__:1');
  const items = doc.content?.[0].content ?? [];
  assert.deepEqual(items.map((i) => i.attrs?.checked), [false, true]);
});

test('contentToEditorDoc: 빈 내용은 빈 문단 하나', () => {
  assert.deepEqual(contentToEditorDoc(''), { type: 'doc', content: [{ type: 'paragraph' }] });
});

test('editorDocToContent: 할 일·문단·서식·글자색을 줄 텍스트로', () => {
  const doc: EditorNode = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [text('[회의] '), text('주간', [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#DC2626' } }])] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [text('끝냄', [{ type: 'strike' }])] }] },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] },
        ],
      },
      { type: 'paragraph' },
      { type: 'paragraph', content: [text('형광', [{ type: 'highlight' }]), text('밑줄', [{ type: 'underline' }])] },
    ],
  };
  assert.equal(editorDocToContent(doc), '[회의] {red}**주간**{/}\n- [x] ~~끝냄~~\n- [ ]\n\n==형광==++밑줄++');
});

test('왕복 변환: 텍스트 → 편집기 → 텍스트가 같은 내용을 낸다', () => {
  const src = '[보고] **실적** 정리\n- [ ] {blue}거래처{/} 방문\n- [x] ~~견적서~~ 발송\n\n메모';
  assert.equal(editorDocToContent(contentToEditorDoc(src)), src);
});

test('toEditableText: 체크 메타를 - [x] 표기로 풀고 메타 줄은 없앤다', () => {
  assert.equal(toEditableText('- 첫째\n- 둘째\n메모\n__c__:1'), '- [ ] 첫째\n- [x] 둘째\n메모');
  assert.equal(toEditableText(toEditableText('- [x] **완료**')), '- [x] **완료**');
});

test('글자 그대로 입력한 서식 기호는 저장 후에도 글자로 남는다', () => {
  const literal = [{ text: 'C++ and C++ / a==b / 2**3**4 / {red}x{/} / 경로 C:\\temp\\', marks: {} }];
  const stored = serializeInlineSegments(literal);
  assert.deepEqual(parseInlineMarks(stored), literal);
  assert.equal(stripInlineMarks(stored), literal[0].text);
});

test('역슬래시 이스케이프: 서식 기호 앞 역슬래시는 글자로 읽고, 그 외 역슬래시는 그대로 둔다', () => {
  assert.deepEqual(parseInlineMarks('\\*\\*굵게 아님\\*\\* C:\\temp'), [{ text: '**굵게 아님** C:\\temp', marks: {} }]);
});

test('editorDocToContent: -·*·[ ] 로 시작하는 일반 문단은 역슬래시를 붙여 일반 줄로 저장', () => {
  const doc: EditorNode = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [text('- 일반 줄')] },
      { type: 'paragraph', content: [text('  * 별표')] },
      { type: 'paragraph', content: [text('[ ] 대괄호')] },
      { type: 'paragraph', content: [text('[회의] 태그는 그대로')] },
    ],
  };
  assert.equal(editorDocToContent(doc), '\\- 일반 줄\n\\  * 별표\n\\[ ] 대괄호\n[회의] 태그는 그대로');
});

test('contentToEditorDoc: 역슬래시로 시작하는 줄은 역슬래시를 떼고 일반 문단으로', () => {
  assert.deepEqual(contentToEditorDoc('\\- 일반 줄'), {
    type: 'doc',
    content: [{ type: 'paragraph', content: [text('- 일반 줄')] }],
  });
  const src = '\\- 일반 줄\n- [ ] 할 일\n\\[ ] 글';
  assert.equal(editorDocToContent(contentToEditorDoc(src)), src);
});

test('줄 맨 앞의 글자 그대로 ** 도 일반 줄로 왕복한다', () => {
  const doc: EditorNode = { type: 'doc', content: [{ type: 'paragraph', content: [text('**굵게 아님')] }] };
  const stored = editorDocToContent(doc);
  assert.deepEqual(contentToEditorDoc(stored), doc);
});
