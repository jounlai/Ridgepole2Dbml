const program = require("commander");
program.parse(process.argv);
const srcFilePath = program.args[0];
const tgtFilePath = program.args[1];

if (program.args.length < 2) {
    console.log('Usage: node main.js [SRC_FILE] [TGT_FILE]');
    process.exit(1);
}

const fs = require("fs");

const parseFirstElement = el => {
    let state = 0,
        head = '',
        name = '';
    for (let i = 0; i < el.length; i++) {
        const ch = el.charAt(i);
        const isSpace = !!ch.match(/\s/);
        const isQuote = ch == '"';
        const isBSlash = ch == '\\';
        switch (state) {
            case 0:
                if (!isSpace) {
                    state = 1;
                    head = ch;
                }
                break;
            case 1:
                if (isSpace) {
                    state = 2;
                } else {
                    head += ch;
                }
                break;
            case 2:
                if (isQuote) {
                    state = 4;
                } else if (!isSpace) {
                    state = 3;
                    name = ch;
                }
                break;
            case 3:
                if (isSpace) {
                    state = 999;
                } else {
                    name += ch;
                }
                break;
            case 4:
                if (isBSlash) {
                    // do nothing
                } else if (isQuote) {
                    state = 999;
                } else {
                    name += ch;
                }
                break;
        }
        if (state === 999) break;
    }
    return {
        head,
        name
    };
};

const parseNextElement = el => {
    let state = 0,
        name = '',
        value = '',
        values = [];
    for (let i = 0, len = el.length; i < len; i++) {
        const ch = el.charAt(i);
        const isSpace = !!ch.match(/\s/);
        const isQuote = ch == '"';
        const isBSlash = ch == '\\';
        switch (state) {
            case 0:
                if (!isSpace) {
                    state = 1;
                    name = ch;
                }
                break;
            case 1:
                if (isSpace) {
                    state = 2;
                } else if (ch === ':') {
                    state = 3;
                } else {
                    name += ch;
                }
                break;
            case 2:
                if (ch === ':') {
                    state = 3;
                } else if (!isSpace) {
                    return false;
                }
                break;
            case 3:
                if (isQuote) {
                    state = 5;
                } else if (!isSpace) {
                    state = 4;
                    value = ch;
                }
                break;
            case 4:
                if (isSpace) {
                    state = 3;
                    values.push(value);
                    value = '';
                } else {
                    value += ch;
                }
                break;
            case 5:
                if (isBSlash) {
                    // do nothing
                } else if (isQuote) {
                    state = 3;
                    values.push(value);
                    value = '';
                } else {
                    value += ch;
                }
                break;
        }
        /*
        if (i < len - 1) {
            console.error('Parse error at LINE ' + __LINE__ + ' "' + el.substr(i + 1) + '"');
            process.exit(1);
        }
        */
    }
    if (value != '') {
        values.push(value);
    }
    return {
        name,
        values
    };
};

const parseLine = line => {
    let head = null,
        name = null,
        params = [];
    line.split(/,/)
        .forEach((el, index) => {
            if (index === 0) {
                const res = parseFirstElement(el);
                head = res.head;
                name = res.name;
            } else {
                const res = parseNextElement(el);
                params[res.name] = res.values;
            }
        });
    return {
        head,
        name,
        params
    };
};

const quote = str => {
    return "'" + str.replace(/'/g, '\\\'') + "'";
};

let __LINE__ = 0;

fs.readFile(srcFilePath, {
    encoding: "utf8"
}, (err, file) => {
    if (err) {
        console.error(err.message);
        // 終了ステータス 1（一般的なエラー）としてプロセスを終了する
        process.exit(1);
        return;
    }
    const typeDict = {
        't.integer': 'integer',
        't.string': 'varchar',
        't.text': 'text',
        't.datetime': 'datetime',
        't.date': 'date',
        't.boolean': 'boolean',
        't.binary': 'blob'
    };

    let dbml = '';
    file.split("\n").forEach(line => {
        __LINE__++;

        // console.log(line);
        let converted = line;
        let matched;
        const res = parseLine(line);

        if (res.head === 'create_table') {
            converted = 'Table "' + res.name + '" {';
            if (res.params.id) {
                if (res.params.id[0] === ':integer') {
                    converted += "\n" +
                        '  id unsigned [pk, increment]';
                } else if (res.params.id.length > 1) {
                    converted += "\n" +
                        '  id varchar(40) [pk] // Unsupported feature. Please check the original source: [' + __LINE__ + '] ' + line;
                }
            }
        } else if (res.head === 'end') {
            converted = '}';
        } else if (matched = res.head.match(/^t\.(\w+)$/)) {
            converted = '  ' + res.name + ' ';
            if (typeof typeDict[res.head] !== 'undefined') {
                converted += typeDict[res.head];


                if (typeof res.params.limit != 'undefined') {
                    converted += '(' + res.params.limit[0] + ')';
                }
                const extra = [];
                if (typeof res.params.comment != 'undefined') {
                    extra.push("note: " + quote(res.params.comment[0]));
                }
                if (typeof res.params.null != 'undefined') {
                    if (res.params.null[0] === 'false')
                        extra.push("not null");
                }            
                if (typeof res.params.default != 'undefined') {
                    let def = null;
                    if (res.params.default.length > 1 &&
                        res.params.default[0] === '->'
                    ) {
                        def = '`' + res.params.default[2] + '`';
                    } else if (res.head === 't.string') {
                        def = quote(res.params.default[0]);
                    } else {
                        def = res.params.default[0];
                    }
                    extra.push("default: " + def);
                }
                if (extra.length > 0) {
                    converted += ' [' + extra.join(', ') + ']';
                }
            } else {
                converted += 'undefined // Unsupported type <' + res.head + '>. Please check the original source: [' + __LINE__ + '] ' + line;
            }
        } else {
            return;
        }

        dbml += converted + "\n";
    });
    fs.writeFile(tgtFilePath, dbml, (err) => {
        if (err) throw err;
        console.log('正常に書き込みが完了しました');
    });
    
});

