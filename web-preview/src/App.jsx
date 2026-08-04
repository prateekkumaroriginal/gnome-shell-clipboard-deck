import {useEffect, useMemo, useRef, useState} from 'react';

const DAY = 24 * 60 * 60 * 1000;

const INITIAL_ITEMS = [
    {
        id: 'terminal-command',
        type: 'text',
        nickname: 'project',
        text: 'export LANGSMITH_PROJECT=writer-agent',
        pinned: true,
    },
    {
        id: 'meeting-note',
        type: 'text',
        nickname: 'follow-up',
        text: 'Send the revised interaction mockup before the design review.',
        pinned: false,
    },
    {
        id: 'screenshot',
        type: 'image',
        nickname: '',
        text: 'Screenshot',
        pinned: false,
    },
    {
        id: 'address',
        type: 'text',
        nickname: 'office',
        text: '21 Indiranagar 100 Feet Road, Bengaluru, Karnataka',
        pinned: false,
    },
    {
        id: 'code',
        type: 'text',
        nickname: '',
        text: "const visibleItems = history.filter(item => item.text.includes(query));",
        pinned: false,
    },
    {
        id: 'long-note',
        type: 'text',
        nickname: 'launch copy',
        text: 'Clipboard Deck keeps your work in place, makes every primary action keyboard accessible, and stores clipboard history locally on this device.',
        pinned: false,
    },
];

const INITIAL_TRASH = [
    {
        id: 'archived-token',
        type: 'text',
        nickname: 'old token',
        text: 'A previously archived clipboard entry',
        pinned: false,
        deletedAt: Date.now() - DAY,
    },
    {
        id: 'archived-image',
        type: 'image',
        nickname: '',
        text: 'Screenshot',
        pinned: false,
        deletedAt: Date.now() - (3 * DAY),
    },
];

function cloneItems(items) {
    return items.map(item => ({...item}));
}

function cx(...classes) {
    return classes.filter(Boolean).join(' ');
}

function Icon({name, className = 'size-4'}) {
    const paths = {
        clipboard: <><path d="M8.5 5.5h7M9 3h6a1 1 0 0 1 1 1v3H8V4a1 1 0 0 1 1-1Z"/><path d="M6 6h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><path d="M8 11h8M8 15h5"/></>,
    };

    return (
        <svg
            viewBox="0 0 24 24"
            className={className}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            {paths[name]}
        </svg>
    );
}

function SymbolicIcon({name, className = 'size-4'}) {
    const paths = {
        pause: <path d="M3 3v10h4V3zm6 0v10h4V3z" />,
        clear: <path d="M8 0C3.588 0 0 3.588 0 8s3.588 8 8 8 8-3.588 8-8-3.588-8-8-8zm0 1c3.872 0 7 3.128 7 7a6.968 6.968 0 0 1-1.71 4.582L3.417 2.711A6.968 6.968 0 0 1 8 1zM2.711 3.418l9.871 9.871A6.968 6.968 0 0 1 8 15c-3.872 0-7-3.128-7-7 0-1.756.647-3.355 1.711-4.582z" />,
        trash: <path d="M7.5 0C6.4 0 5.355.32 5.355.32L5 .428v1.683A13.88 13.88 0 0 0 2.002 3L2 4H1v1h1l.004 9c0 .439.04.788.15 1.082.111.294.311.528.563.668.503.28 1.12.25 1.953.25h5.664c.833 0 1.45.03 1.953-.25.252-.14.45-.374.56-.668.11-.294.153-.643.153-1.082l-.002-8h-1L12 14c0 .376-.04.603-.088.729-.034.09-.078.129-.11.146-.173.097-.611.125-1.468.125H4.67c-.857 0-1.295-.028-1.469-.125a.267.267 0 0 1-.113-.146v-.002c-.046-.122-.084-.348-.084-.727v-.002L3 5h11V4h-1.002L13 3a13.855 13.855 0 0 0-3-.889V.45L9.67.331S8.757.001 7.5.001zm0 1c.89 0 1.29.155 1.5.22v.739a14.05 14.05 0 0 0-1.498-.084c-.502 0-1.003.032-1.502.086v-.734C6.266 1.157 6.772 1 7.5 1zM5 6v6h1V6zm2 0v6h1V6zm2 0v6h1V6z" />,
        restore: <><path d="M8 3v5a36.973 36.973 0 0 1-2.324-1.166A44.09 44.09 0 0 1 3.417 5.5a52.149 52.149 0 0 1 2.26-1.32A43.18 43.18 0 0 1 8 3z"/><path d="M7 5v1h4.5C12.894 6 14 7.106 14 8.5S12.894 11 11.5 11H1v1h10.5c1.93 0 3.5-1.57 3.5-3.5S13.43 5 11.5 5h-4z"/></>,
        undo: <><path d="M6.983 3v5a36.973 36.973 0 0 1-2.324-1.166A44.09 44.09 0 0 1 2.4 5.5a52.149 52.149 0 0 1 2.26-1.32A43.18 43.18 0 0 1 6.983 3z"/><path d="M5.983 5v1h4.5c1.394 0 2.5 1.106 2.5 2.5s-1.106 2.5-2.5 2.5h-3.5v1h3.5c1.93 0 3.5-1.57 3.5-3.5s-1.57-3.5-3.5-3.5h-4z"/></>,
        hash: <path d="M5.2 1h1.5l-.5 3H10l.5-3H12l-.5 3H14v1.5h-2.8l-.8 5H13V12h-2.8l-.5 3H8.2l.5-3H4.9l-.5 3H2.9l.5-3H1v-1.5h2.7l.8-5H2V4h2.8l.4-3zm.7 4.5-.8 5H9l.8-5H5.9z"/>,
    };

    return <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden="true">{paths[name]}</svg>;
}

function ToolbarButton({label, pressed, disabled, onClick, children}) {
    return (
        <button
            type="button"
            className={cx(
                'grid size-8 shrink-0 place-items-center rounded-lg border-0 p-[7px]',
                'bg-[#2b2e37] text-[#d7d8df]',
                'hover:bg-[#363a45] hover:text-white focus-visible:bg-[#363a45] focus-visible:text-white focus-visible:outline-0',
                pressed && '!bg-[var(--popup-accent)] !text-[#211a0e]',
                disabled && 'cursor-default opacity-40'
            )}
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function PinIcon({filled}) {
    return (
        <svg viewBox="0 0 16 16" className="size-3.5 rotate-45" aria-hidden="true">
            <path
                d="M5 1.5h6l-1.4 4L12 7.8v1H8.8V14L8 15l-.8-1V8.8H4v-1l2.4-2.3Z"
                fill={filled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={filled ? 0 : 1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function ActionButton({label, danger, visible, active, onClick, children}) {
    return (
        <button
            type="button"
            className={cx(
                'size-[18px] place-items-center rounded-[5px] border-0 bg-transparent p-0',
                'text-[#abadb7]',
                danger
                    ? 'hover:bg-[#4a3032] hover:text-[#ffb4ae] focus-visible:bg-[#4a3032] focus-visible:text-[#ffb4ae]'
                    : 'hover:bg-[#403a2e] hover:text-[#e7aa3d] focus-visible:bg-[#403a2e] focus-visible:text-[#e7aa3d]',
                'focus-visible:outline-0',
                active && 'text-[color:var(--popup-accent)]',
                visible ? 'grid' : 'hidden group-hover:grid'
            )}
            aria-label={label}
            onClick={event => {
                event.stopPropagation();
                onClick();
            }}
        >
            {children}
        </button>
    );
}

function expiryLabel(item) {
    const elapsed = Math.max(0, Math.floor((Date.now() - item.deletedAt) / DAY));
    const remaining = Math.max(0, 7 - elapsed);
    const archived = elapsed === 0 ? 'Archived today' : `Archived ${elapsed} day${elapsed === 1 ? '' : 's'} ago`;
    const expires = remaining === 0 ? 'Deletes today' : `Deletes in ${remaining} day${remaining === 1 ? '' : 's'}`;
    return `${archived} · ${expires}`;
}

function HistoryItem({item, selected, archived, onPaste, onNickname, onPin, onArchive, onRestore, onDelete}) {
    const nicknameElement = item.nickname && (
        <div className="mb-[3px] overflow-hidden text-ellipsis whitespace-nowrap text-xs font-medium leading-tight text-[color:var(--popup-accent)]">
            {item.nickname}
        </div>
    );
    const expiryElement = archived && (
        <div className="mb-[3px] text-[11px] leading-tight text-[color:var(--popup-muted)]">
            {expiryLabel(item)}
        </div>
    );

    return (
        <div
            role="option"
            aria-selected={selected}
            className={cx(
                'group flex min-h-16 items-start gap-2 rounded-[9px] border-2 px-2.5 py-2.5 pl-3',
                'text-[color:var(--popup-ink)]',
                archived ? 'cursor-default bg-[#272a31] hover:bg-[#30333b]' : 'cursor-pointer bg-[#2b2e37] hover:bg-[#343741]',
                selected && '!border-[var(--popup-accent)] !bg-[var(--popup-selected)]',
                !selected && 'border-transparent'
            )}
            onMouseDown={event => event.preventDefault()}
            onClick={() => {
                if (!archived)
                    onPaste();
            }}
        >
            <div className="min-w-0 flex-1">
                {item.type === 'image' ? (
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="mock-thumbnail" aria-label="Screenshot thumbnail" />
                        <div className="min-w-0 flex-1">
                            {nicknameElement}
                            {expiryElement}
                            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">
                                {item.text}
                            </span>
                        </div>
                    </div>
                ) : (
                    <>
                        {nicknameElement}
                        {expiryElement}
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-semibold">
                                {item.text}
                            </span>
                        </div>
                    </>
                )}
            </div>

            <div className="ml-auto flex items-start gap-2">
                {archived ? (
                    <>
                        <ActionButton label="Restore archived item" visible={selected} onClick={onRestore}>
                            <SymbolicIcon name="undo" className="size-3.5" />
                        </ActionButton>
                        <ActionButton label="Delete permanently" danger visible={selected} onClick={onDelete}>
                            <SymbolicIcon name="trash" className="size-3.5" />
                        </ActionButton>
                    </>
                ) : (
                    <>
                        <ActionButton label={item.nickname ? 'Edit nickname' : 'Add nickname'} visible={selected} active={Boolean(item.nickname)} onClick={onNickname}>
                            <SymbolicIcon name="hash" className="size-3.5" />
                        </ActionButton>
                        <ActionButton label="Archive item to Trash" danger visible={selected} onClick={onArchive}>
                            <SymbolicIcon name="trash" className="size-3.5" />
                        </ActionButton>
                        <ActionButton label={item.pinned ? 'Unpin item' : 'Pin item'} visible={selected || item.pinned} active={item.pinned} onClick={onPin}>
                            <PinIcon filled={item.pinned} />
                        </ActionButton>
                    </>
                )}
            </div>
        </div>
    );
}

function EmptyState({view, paused, hasQuery}) {
    let text;
    if (view === 'trash')
        text = hasQuery ? 'No archived items match this search.' : 'Trash is empty. Archived items stay here for seven days.';
    else if (paused)
        text = 'Capture is paused. Your saved history is still available after you resume.';
    else if (hasQuery)
        text = 'No copied items match this search.';
    else
        text = 'Copy something, then use your configured shortcut to find it here.';

    return (
        <div className="px-5 py-[70px] text-center text-sm text-[#abadb7]">
            <p className="m-0">{text}</p>
        </div>
    );
}

function ConfirmDialog({onCancel, onConfirm}) {
    return (
        <div className="absolute inset-0 z-30 grid place-items-center bg-[rgba(7,7,10,0.72)] p-5">
            <section role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="flex w-80 flex-col gap-3 rounded-xl border border-[#4a4d58] bg-[#24262e] p-[18px] text-[#f2f2f6] shadow-[0_12px_30px_rgba(0,0,0,0.5)]">
                <h3 id="confirm-title" className="m-0 text-base font-bold">Clear clipboard history?</h3>
                <p className="m-0 text-[13px] text-[#c5c6ce]">
                    All items will move to Trash and remain restorable for seven days.
                </p>
                <div className="flex justify-end gap-2">
                    <button autoFocus type="button" onClick={onCancel} className="rounded-[7px] border-0 bg-[#343741] px-3 py-1.5 text-[13px] font-semibold hover:bg-[#414550] focus-visible:bg-[#414550] focus-visible:outline-0">Cancel</button>
                    <button type="button" onClick={onConfirm} className="rounded-[7px] border-0 bg-[#ffb4ae] px-3 py-1.5 text-[13px] font-semibold text-[#2b1111] hover:bg-[#ffc6c1] focus-visible:bg-[#ffc6c1] focus-visible:outline-0">Delete</button>
                </div>
            </section>
        </div>
    );
}

export default function App() {
    const [open, setOpen] = useState(true);
    const [view, setView] = useState('history');
    const [paused, setPaused] = useState(false);
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState(0);
    const [items, setItems] = useState(() => cloneItems(INITIAL_ITEMS));
    const [trash, setTrash] = useState(() => cloneItems(INITIAL_TRASH));
    const [confirming, setConfirming] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [nickname, setNickname] = useState('');
    const [toast, setToast] = useState('');
    const [mockTarget, setMockTarget] = useState('The mocked paste result will appear here.');
    const searchRef = useRef(null);
    const nicknameRef = useRef(null);
    const toastTimer = useRef(null);

    useEffect(() => () => clearTimeout(toastTimer.current), []);

    useEffect(() => {
        focusSearch();
    }, []);

    const sourceItems = view === 'trash' ? trash : items;
    const visibleItems = useMemo(() => {
        const needle = query.trim().toLocaleLowerCase();
        if (!needle)
            return sourceItems;
        return sourceItems.filter(item => (
            item.nickname?.toLocaleLowerCase().includes(needle) ||
            item.text.toLocaleLowerCase().includes(needle) ||
            (item.type === 'image' && 'screenshot image'.includes(needle))
        ));
    }, [query, sourceItems]);

    useEffect(() => {
        if (visibleItems.length === 0)
            setSelected(-1);
        else
            setSelected(index => Math.min(Math.max(index, 0), visibleItems.length - 1));
    }, [visibleItems.length]);

    function notify(message) {
        clearTimeout(toastTimer.current);
        setToast(message);
        toastTimer.current = setTimeout(() => setToast(''), 2300);
    }

    function focusSearch() {
        requestAnimationFrame(() => searchRef.current?.focus());
    }

    function openPopup() {
        setOpen(true);
        setView('history');
        setQuery('');
        setSelected(0);
        setConfirming(false);
        setEditingId(null);
        focusSearch();
    }

    function closePopup() {
        setOpen(false);
        setConfirming(false);
        setEditingId(null);
    }

    function selectView(nextView) {
        setView(nextView);
        setSelected(0);
        setQuery('');
        setEditingId(null);
        focusSearch();
    }

    function pasteItem(item, shouldPaste = true) {
        closePopup();
        if (shouldPaste) {
            setMockTarget(item.type === 'image' ? '[Screenshot pasted here]' : item.text);
            notify(item.type === 'image' ? 'Mock paste · Screenshot' : `Mock paste · ${item.text}`);
        } else {
            notify(item.type === 'image' ? 'Mock clipboard · Screenshot copied' : `Mock clipboard · ${item.text}`);
        }
    }

    function togglePin(id) {
        setItems(current => current.map(item => item.id === id ? {...item, pinned: !item.pinned} : item));
        focusSearch();
    }

    function archiveItem(id) {
        const item = items.find(candidate => candidate.id === id);
        if (!item)
            return;
        setItems(current => current.filter(candidate => candidate.id !== id));
        setTrash(current => [{...item, deletedAt: Date.now()}, ...current]);
        notify('Moved to Trash · Restorable for 7 days');
        focusSearch();
    }

    function restoreItem(id) {
        const item = trash.find(candidate => candidate.id === id);
        if (!item)
            return;
        const {deletedAt: _deletedAt, ...restored} = item;
        setTrash(current => current.filter(candidate => candidate.id !== id));
        setItems(current => [restored, ...current]);
        notify('Item restored to clipboard history');
        focusSearch();
    }

    function deleteTrashItem(id) {
        setTrash(current => current.filter(item => item.id !== id));
        notify('Item permanently deleted');
        focusSearch();
    }

    function startNickname(item) {
        setEditingId(item.id);
        setNickname(item.nickname ?? '');
        requestAnimationFrame(() => nicknameRef.current?.focus());
    }

    function saveNickname(event) {
        event?.preventDefault();
        setItems(current => current.map(item => item.id === editingId ? {...item, nickname: nickname.trim().slice(0, 80)} : item));
        setEditingId(null);
        focusSearch();
    }

    function confirmClear() {
        const now = Date.now();
        setTrash(current => [...items.map(item => ({...item, deletedAt: now})), ...current]);
        setItems([]);
        setConfirming(false);
        setSelected(-1);
        notify('History moved to Trash');
        focusSearch();
    }

    function restoreAll() {
        const restored = trash.map(({deletedAt: _deletedAt, ...item}) => item);
        setItems(current => [...restored, ...current]);
        setTrash([]);
        notify('All archived items restored');
        focusSearch();
    }

    useEffect(() => {
        function handleKeyDown(event) {
            if (!open) {
                if (event.key.toLocaleLowerCase() === 'v' && event.metaKey) {
                    event.preventDefault();
                    openPopup();
                }
                return;
            }

            if (editingId) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    setEditingId(null);
                    focusSearch();
                }
                return;
            }

            if (confirming) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    setConfirming(false);
                    focusSearch();
                }
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                closePopup();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (visibleItems.length) {
                    const delta = event.key === 'ArrowDown' ? 1 : -1;
                    setSelected(index => (index + delta + visibleItems.length) % visibleItems.length);
                }
            } else if (event.key === 'Enter' && visibleItems[selected]) {
                event.preventDefault();
                if (view === 'history')
                    pasteItem(visibleItems[selected], !event.shiftKey);
            } else if (event.key === 'Delete' && visibleItems[selected]) {
                event.preventDefault();
                if (view === 'trash')
                    deleteTrashItem(visibleItems[selected].id);
                else
                    archiveItem(visibleItems[selected].id);
            } else if (event.ctrlKey && event.key.toLocaleLowerCase() === 'p' && visibleItems[selected] && view === 'history') {
                event.preventDefault();
                togglePin(visibleItems[selected].id);
            } else if (event.ctrlKey && event.key.toLocaleLowerCase() === 'n' && visibleItems[selected] && view === 'history') {
                event.preventDefault();
                startNickname(visibleItems[selected]);
            } else if (event.key === '/' && document.activeElement !== searchRef.current) {
                event.preventDefault();
                focusSearch();
            }
        }

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    });

    useEffect(() => {
        document.querySelector('[aria-selected="true"]')?.scrollIntoView({block: 'nearest'});
    }, [selected]);

    const showEmpty = (view === 'history' && paused) || visibleItems.length === 0;
    return (
        <main className="min-h-screen bg-[var(--lab-bg)] text-[color:var(--lab-text)]">
            <section aria-label="Clipboard Deck preview canvas" className="min-w-0">
                <div className={cx('desktop', open && 'has-popup')}>
                        <div className="mock-workspace" aria-label="Mock application behind the popup">
                            <div className="mock-document">
                                <span className="line-number">1</span><strong>Launch notes</strong>
                                <span className="line-number">2</span><span />
                                <span className="line-number">3</span><span>Use this quiet workspace to judge how the popup feels</span>
                                <span className="line-number">4</span><span>over another application.</span>
                                <span className="line-number">5</span><span />
                                <span className="line-number">6</span><span key={mockTarget} className={mockTarget.startsWith('The mocked') ? '' : 'just-pasted'}>{mockTarget}</span>
                            </div>
                        </div>
                        <button type="button" className="desktop-dim" aria-label="Close Clipboard Deck" tabIndex={-1} onClick={closePopup} />

                        <section className={cx('clipboard-popup', open && 'is-open', editingId && 'has-nickname-editor')} aria-label="Clipboard Deck popup preview" aria-hidden={!open}>
                            <header className="flex h-[34px] items-center gap-2">
                                <h2 className="m-0 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-lg font-bold">{view === 'trash' ? 'Clipboard Deck — Trash' : 'Clipboard Deck'}</h2>
                                <div className="flex items-center gap-2">
                                    <ToolbarButton label={paused ? 'Resume clipboard capture' : 'Pause clipboard capture'} pressed={paused} onClick={() => { setPaused(value => !value); setSelected(0); focusSearch(); }}><SymbolicIcon name="pause" /></ToolbarButton>
                                    {view === 'history' ? (
                                        <ToolbarButton label="Clear clipboard history" disabled={items.length === 0} onClick={() => setConfirming(true)}><SymbolicIcon name="clear" /></ToolbarButton>
                                    ) : (
                                        <ToolbarButton label="Restore all archived items" disabled={trash.length === 0} onClick={restoreAll}><SymbolicIcon name="restore" /></ToolbarButton>
                                    )}
                                    <ToolbarButton label={view === 'trash' ? 'Show clipboard history' : 'Show Trash'} pressed={view === 'trash'} onClick={() => selectView(view === 'trash' ? 'history' : 'trash')}><SymbolicIcon name="trash" /></ToolbarButton>
                                </div>
                            </header>

                            <label className="relative flex items-center">
                                <span className="sr-only">Search copied items or nicknames</span>
                                <input ref={searchRef} type="text" value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} placeholder="Search copied items or nicknames" className="wc-search h-[42px] w-full rounded-[9px] border border-[#40434e] bg-[#2b2e37] px-3 text-sm text-[#f2f2f6] caret-[#f2f2f6] outline-0 placeholder:text-[#abadb7] focus:border-[#e7aa3d] focus:shadow-[0_0_0_1px_#e7aa3d]" />
                            </label>

                            {editingId && (
                                <form onSubmit={saveNickname} className="grid min-h-[38px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] border border-[#4b4435] bg-[#24262e] px-2 py-[7px]">
                                    <label htmlFor="nickname" className="text-xs text-[#abadb7]">Nickname</label>
                                    <input ref={nicknameRef} id="nickname" value={nickname} onChange={event => setNickname(event.target.value)} maxLength={80} placeholder="e.g. greeting" className="wc-nickname-input h-[27px] min-w-0 rounded-md border border-[#555966] bg-[#1c1e25] px-2 text-[#f2f2f6] outline-0 focus:border-[#e7aa3d]" />
                                    <button type="submit" className="h-[27px] rounded-md border-0 bg-[#e7aa3d] px-[9px] text-xs font-semibold text-[#211a0e] hover:bg-[#f2bc58] focus-visible:bg-[#f2bc58] focus-visible:outline-0">Save</button>
                                </form>
                            )}

                            <div className="history-scroll min-h-0 overflow-auto">
                                <div role="listbox" aria-label={view === 'trash' ? 'Archived clipboard items' : 'Clipboard history'} className="flex min-h-full flex-col gap-1.5">
                                    {showEmpty ? (
                                        <EmptyState view={view} paused={view === 'history' && paused} hasQuery={Boolean(query.trim())} />
                                    ) : visibleItems.map((item, index) => (
                                        <HistoryItem
                                            key={item.id}
                                            item={item}
                                            selected={selected === index}
                                            archived={view === 'trash'}
                                            onPaste={() => pasteItem(item)}
                                            onNickname={() => startNickname(item)}
                                            onPin={() => togglePin(item.id)}
                                            onArchive={() => archiveItem(item.id)}
                                            onRestore={() => restoreItem(item.id)}
                                            onDelete={() => deleteTrashItem(item.id)}
                                        />
                                    ))}
                                </div>
                            </div>

                            <footer className="flex h-[34px] items-end gap-[22px] border-t border-[#3d4049] px-0.5 pt-[7px] text-xs text-[#abadb7]">
                                <span>↑↓&nbsp; Navigate</span>
                                <span>Enter&nbsp; Paste</span>
                                <span>Esc&nbsp; Close</span>
                            </footer>
                        </section>

                        {confirming && <ConfirmDialog onCancel={() => { setConfirming(false); focusSearch(); }} onConfirm={confirmClear} />}

                        {!open && (
                            <button type="button" onClick={openPopup} className="reopen-card">
                                <span className="reopen-icon"><Icon name="clipboard" /></span>
                                <span><strong>Clipboard Deck closed</strong><small>Open it again to continue exploring</small></span>
                                <kbd>Super V</kbd>
                            </button>
                        )}
                        {toast && <div role="status" className="canvas-toast">{toast}</div>}
                </div>
            </section>
        </main>
    );
}
