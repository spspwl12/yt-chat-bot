/**
 * 전역 이벤트 버스 — 모듈 간 순환 참조 없이 이벤트를 전달.
 * search.js, commands.js → web-server.js 로 로그를 보내는 용도.
 */
const EventEmitter = require('events');
module.exports = new EventEmitter();
