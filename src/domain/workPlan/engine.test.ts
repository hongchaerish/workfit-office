import assert from 'node:assert/strict';
import test from 'node:test';
import { calculatePlanProgress, parseWorkPlanItems, toggleWorkPlanItem } from './engine';

test('parseWorkPlanItems: 역슬래시로 시작하는 줄은 - 로 시작해도 일반 줄', () => {
  const [plain, star, box] = parseWorkPlanItems('\\- 일반 줄\n\\* 별표 메모\n\\[ ] 대괄호 글');
  assert.equal(plain.isChecklist, false);
  assert.equal(plain.text, '- 일반 줄');
  assert.equal(star.text, '* 별표 메모');
  assert.equal(box.isChecklist, false);
  assert.equal(box.text, '[ ] 대괄호 글');
});

test('parseWorkPlanItems: 예전에 저장된 - 줄과 - [ ] 줄은 계속 할 일', () => {
  const items = parseWorkPlanItems('- 예전 할 일\n- [x] 완료\n메모');
  assert.deepEqual(items.map((i) => i.isChecklist), [true, true, false]);
});

test('일반 줄로 이스케이프한 줄은 진행률·토글에 영향을 주지 않는다', () => {
  const content = '\\- 일반 줄\n- [ ] 할 일';
  assert.deepEqual(calculatePlanProgress(content), { total: 1, completed: 0, percent: 0 });
  assert.equal(toggleWorkPlanItem(content, 1), '\\- 일반 줄\n- [x] 할 일');
});
