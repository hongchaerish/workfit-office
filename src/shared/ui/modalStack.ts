/** 열려 있는 공통 모달의 쌓인 순서 — 겹쳐 열렸을 때 Esc 는 맨 위 창만 닫는다 */
export function createModalStack() {
  const stack: symbol[] = [];
  return {
    push(): symbol {
      const id = Symbol('modal');
      stack.push(id);
      return id;
    },
    remove(id: symbol): void {
      const i = stack.indexOf(id);
      if (i >= 0) stack.splice(i, 1);
    },
    isTop(id: symbol): boolean {
      return stack[stack.length - 1] === id;
    },
  };
}

export const modalStack = createModalStack();
