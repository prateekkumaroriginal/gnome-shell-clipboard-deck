import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

// Exercise the real store without loading GNOME Shell's UI or GI imports in Node.
const source = readFileSync(new URL('../extension/extension.js', import.meta.url), 'utf8');
const constants = source.slice(source.indexOf('const HISTORY_LIMIT ='),
    source.indexOf('const POPUP_WIDTH ='));
const storeClass = source.slice(source.indexOf('class HistoryStore {'),
    source.indexOf('\nclass ClipboardPopup {'));
const HistoryStore = runInNewContext(`${constants}\n(${storeClass})`);

function createStore(items) {
    const store = Object.create(HistoryStore.prototype);
    store.items = items;
    store.scheduleSave = () => {};
    store.removedImages = [];
    store._deleteImageIfUnused = item => store.removedImages.push(item);
    return store;
}

function entries(count, extra = {}) {
    return Array.from({length: count}, (_, index) => ({
        id: `entry-${index}`,
        type: 'text',
        text: `Entry ${index}`,
        createdAt: count - index,
        pinned: false,
        ...extra,
    }));
}

test('nicknamed text and images survive beyond the 200 ordinary entries', () => {
    const ordinary = entries(201);
    const tagged = entries(201, {nickname: 'Saved', createdAt: 0});
    const image = {id: 'image', type: 'image', nickname: 'Screenshot', byteSize: 1024, createdAt: 0};
    const store = createStore([...ordinary, ...tagged, image]);

    store._prune();

    assert.equal(store.items.length, 402);
    assert.ok(ordinary.slice(0, 200).every(item => store.items.includes(item)));
    assert.ok(!store.items.includes(ordinary[200]));
    assert.ok(tagged.every(item => store.items.includes(item)));
    assert.ok(store.items.includes(image));
    assert.equal(store.removedImages.length, 0);
});

test('pinned ordinary entries still count toward the limit and keep priority', () => {
    const ordinary = entries(200);
    const pinned = {id: 'pinned', type: 'text', pinned: true, createdAt: 0};
    const tagged = {id: 'tagged', type: 'text', pinned: true, nickname: 'Saved', createdAt: 0};
    const store = createStore([...ordinary, pinned, tagged]);

    store._prune();

    assert.equal(store.items.length, 201);
    assert.ok(store.items.includes(pinned));
    assert.ok(store.items.includes(tagged));
    assert.ok(!store.items.includes(ordinary[199]));
});

test('clearing a nickname immediately returns the entry to the ordinary limit', () => {
    const ordinary = entries(200);
    const tagged = {id: 'tagged', type: 'text', nickname: 'Saved', createdAt: 0};
    const store = createStore([...ordinary, tagged]);

    store.setNickname('tagged', '   ');

    assert.equal(store.items.length, 200);
    assert.ok(!store.items.includes(tagged));
});

test('restored nicknamed entries do not displace ordinary history', () => {
    for (const restoreAll of [false, true]) {
        const ordinary = entries(200);
        const tagged = {id: 'tagged', type: 'text', nickname: 'Saved', createdAt: 0, deletedAt: 1};
        const store = createStore([...ordinary, tagged]);

        if (restoreAll)
            store.restoreAll();
        else
            store.restore('tagged');

        assert.equal(store.items.length, 201);
        assert.ok(store.items.includes(tagged));
        assert.equal(store.archived().length, 0);
    }
});

test('nicknamed images still obey the image byte limit and archived entries remain separate', () => {
    const ordinary = entries(200);
    const image = {id: 'image', type: 'image', nickname: 'Saved', byteSize: 250 * 1024 * 1024, createdAt: 2};
    const overflow = {id: 'overflow', type: 'image', nickname: 'Older', byteSize: 1, createdAt: 1};
    const archived = {id: 'archived', type: 'text', deletedAt: 1};
    const store = createStore([...ordinary, image, overflow, archived]);

    store._prune();

    assert.equal(store.items.length, 202);
    assert.ok(store.items.includes(image));
    assert.ok(store.items.includes(archived));
    assert.ok(!store.items.includes(overflow));
    assert.deepEqual(store.removedImages, [overflow]);
});
