import assert from 'node:assert/strict';
import test from 'node:test';
import { caretAfter, formatAccountNoTyping, formatBizNoTyping, formatPhoneTyping, isValidEmail, isValidHomepage, homepageHref } from './inputFormat';

test('사업자등록번호 — 치는 동안 3-2-5 로 하이픈, 숫자만 10자리까지', () => {
  assert.equal(formatBizNoTyping(''), '');
  assert.equal(formatBizNoTyping('123'), '123');
  assert.equal(formatBizNoTyping('1234'), '123-4');
  assert.equal(formatBizNoTyping('12345'), '123-45');
  assert.equal(formatBizNoTyping('123456'), '123-45-6');
  assert.equal(formatBizNoTyping('1234567890'), '123-45-67890');
  assert.equal(formatBizNoTyping('12345678901'), '123-45-67890');
  assert.equal(formatBizNoTyping('12a3-4 5'), '123-45');
});

test('전화번호 — 서울 02', () => {
  assert.equal(formatPhoneTyping('02'), '02');
  assert.equal(formatPhoneTyping('0212'), '02-12');
  assert.equal(formatPhoneTyping('021234567'), '02-123-4567');
  assert.equal(formatPhoneTyping('0212345678'), '02-1234-5678');
});

test('전화번호 — 휴대폰·지역번호·인터넷전화', () => {
  assert.equal(formatPhoneTyping('010'), '010');
  assert.equal(formatPhoneTyping('0101'), '010-1');
  assert.equal(formatPhoneTyping('0101234'), '010-1234');
  assert.equal(formatPhoneTyping('01012345678'), '010-1234-5678');
  assert.equal(formatPhoneTyping('0311234567'), '031-123-4567');
  assert.equal(formatPhoneTyping('07012345678'), '070-1234-5678');
});

test('전화번호 — 대표번호(15xx·16xx·18xx)와 0505', () => {
  assert.equal(formatPhoneTyping('1588'), '1588');
  assert.equal(formatPhoneTyping('15881234'), '1588-1234');
  assert.equal(formatPhoneTyping('050512345678'), '0505-1234-5678');
});

test('전화번호 — 내선 등 글자가 섞이면 친 그대로 둔다', () => {
  assert.equal(formatPhoneTyping('02-123-4567 내선 12'), '02-123-4567 내선 12');
  assert.equal(formatPhoneTyping('+82 2 1234 5678'), '+82 2 1234 5678');
  // 한 글자씩 칠 때 '내선' 앞 띄어쓰기가 지워지지 않아야 한다
  assert.equal(formatPhoneTyping('02-123-4567 '), '02-123-4567 ');
  assert.equal(formatPhoneTyping('(02) 1234'), '(02) 1234');
});

test('계좌번호 — 은행마다 모양이 달라 하이픈은 친 대로, 숫자·하이픈 외 글자와 겹친 하이픈만 뺀다', () => {
  assert.equal(formatAccountNoTyping('110-123-456789'), '110-123-456789');
  assert.equal(formatAccountNoTyping('110 123a456'), '110123456');
  assert.equal(formatAccountNoTyping('110--123'), '110-123');
});

test('커서 — 앞에 있던 숫자 개수만큼 지나간 자리로', () => {
  assert.equal(caretAfter('123-45-6', 4), 5);
  assert.equal(caretAfter('123-45-6', 3), 3);
  assert.equal(caretAfter('123-45-6', 0), 0);
  assert.equal(caretAfter('123-45-6', 6), 8);
});

test('이메일 — 비어 있으면 통과, 모양이 틀리면 막는다', () => {
  assert.equal(isValidEmail(''), true);
  assert.equal(isValidEmail('tax@daesung.co.kr'), true);
  assert.equal(isValidEmail('tax@daesung'), false);
  assert.equal(isValidEmail('tax daesung.co.kr'), false);
});

test('홈페이지 — 주소 모양 확인, 링크는 https 를 붙인다', () => {
  assert.equal(isValidHomepage(''), true);
  assert.equal(isValidHomepage('www.daesung.co.kr'), true);
  assert.equal(isValidHomepage('https://daesung.co.kr/about'), true);
  assert.equal(isValidHomepage('대성반도체'), false);
  assert.equal(isValidHomepage('daesung co kr'), false);
  assert.equal(homepageHref('www.daesung.co.kr'), 'https://www.daesung.co.kr');
  assert.equal(homepageHref('http://daesung.co.kr'), 'http://daesung.co.kr');
});
