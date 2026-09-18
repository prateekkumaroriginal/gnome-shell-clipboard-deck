export function filterItems(items, rawQuery) {
    const query = rawQuery.trim().toLocaleLowerCase();
    if (!query)
        return items;

    const isTagSearch = query.startsWith('#');
    const needle = isTagSearch ? query.slice(1).trimStart() : query;
    const nicknameMatches = item =>
        Boolean(item.nickname?.toLocaleLowerCase().includes(needle));
    const contentMatches = item => {
        const content = item.type === 'text' ? item.text : 'screenshot image';
        return content.toLocaleLowerCase().includes(needle);
    };

    if (!isTagSearch)
        return items.filter(item =>
            nicknameMatches(item) || contentMatches(item));

    const tagged = [];
    const other = [];
    for (const item of items) {
        if (nicknameMatches(item))
            tagged.push(item);
        else if (contentMatches(item))
            other.push(item);
    }
    return [...tagged, ...other];
}
