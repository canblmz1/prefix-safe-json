import json
import os

os.makedirs('c:/dev/parser/corpus/canonical', exist_ok=True)

def write_fixture(id_name, title, data_str, end_reason, syntax, outcome, executable, stable_val, diagnostics=None, notes=None):
    if diagnostics is None:
        diagnostics = []
    
    doc = {
        "version": 1,
        "id": id_name,
        "title": title,
        "category": "canonical",
        "input": {
            "encoding": "utf8-text",
            "data": data_str
        },
        "stream": {
            "endReason": end_reason,
            "chunkStrategies": ["single", "byte-per-chunk", "char-per-chunk"]
        },
        "expected": {
            "syntax": syntax,
            "outcome": outcome,
            "stableValue": stable_val,
            "finalValue": stable_val,
            "executable": executable,
            "diagnostics": diagnostics,
            "repairs": [],
            "events": []
        },
        "provenance": {
            "source": "synthetic"
        }
    }
    if notes:
        doc["provenance"]["notes"] = notes

    with open(f"c:/dev/parser/corpus/canonical/{id_name}.json", "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)

write_fixture(
    "canonical-valid-004", "Empty containers",
    r'{"empty_obj":{},"empty_arr":[]}', "complete",
    "root_complete", "valid", True,
    {"empty_obj":{},"empty_arr":[]}
)

write_fixture(
    "canonical-valid-005", "String with escapes",
    r'{"msg":"line1\nline2\ttab","path":"c:\\dir\\file","quote":"she said \"hi\""}', "complete",
    "root_complete", "valid", True,
    {"msg":"line1\nline2\ttab","path":"c:\\dir\\file","quote":"she said \"hi\""}
)

write_fixture(
    "canonical-string-001", "String split mid-word",
    r'{"path":"/src/app.ts","content":"hello world"}', "complete",
    "root_complete", "valid", True,
    {"path":"/src/app.ts","content":"hello world"},
    notes="Tests that splitting within a string value does not affect result"
)

write_fixture(
    "canonical-string-002", "Incomplete string (stream truncated)",
    r'{"path":"/src/app.ts","content":"hello worl', "length",
    "incomplete", "truncated", False,
    {"path":"/src/app.ts"},
    diagnostics=[{"code":"E_UNTERMINATED_STRING","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-string-003", "Escape at chunk boundary",
    r'{"msg":"hello\nworld"}', "complete",
    "root_complete", "valid", True,
    {"msg":"hello\nworld"},
    notes="Backslash-n escape split across chunk boundaries"
)

write_fixture(
    "canonical-string-004", "Unicode escape split",
    r'{"char":"\u0041"}', "complete",
    "root_complete", "valid", True,
    {"char":"A"},
    notes="Unicode escape \\u0041 decodes to letter 'A'"
)

write_fixture(
    "canonical-utf8-001", "2-byte UTF-8",
    r'{"name":"José"}', "complete",
    "root_complete", "valid", True,
    {"name":"José"}
)

write_fixture(
    "canonical-utf8-002", "3-byte UTF-8 (CJK)",
    r'{"text":"日本語"}', "complete",
    "root_complete", "valid", True,
    {"text":"日本語"}
)

write_fixture(
    "canonical-utf8-003", "4-byte emoji",
    r'{"emoji":"😀"}', "complete",
    "root_complete", "valid", True,
    {"emoji":"😀"}
)

write_fixture(
    "canonical-utf8-004", "Incomplete unicode escape at stream end",
    r'{"char":"\u00', "length",
    "incomplete", "truncated", False,
    {},
    diagnostics=[{"code":"E_INCOMPLETE_UNICODE_ESCAPE","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-number-001", "Numbers in object",
    r'{"x":42,"y":100}', "complete",
    "root_complete", "valid", True,
    {"x":42,"y":100}
)

write_fixture(
    "canonical-number-002", "Incomplete number at stream end",
    r'{"value":12', "length",
    "incomplete", "truncated", False,
    {},
    diagnostics=[{"code":"E_INCOMPLETE_NUMBER","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}],
    notes="Number 12 has no terminator so cannot be committed"
)

write_fixture(
    "canonical-number-003", "Incomplete literal at stream end",
    r'{"flag":tru', "length",
    "incomplete", "truncated", False,
    {},
    diagnostics=[{"code":"E_INCOMPLETE_LITERAL","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-container-001", "Unclosed object with terminated values",
    r'{"a":1,"b":2', "length",
    "incomplete", "truncated", False,
    {"a":1},
    diagnostics=[{"code":"E_INCOMPLETE_NUMBER","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-container-002", "Unclosed array",
    r'{"items":[1,2,3', "length",
    "incomplete", "truncated", False,
    {},
    diagnostics=[{"code":"E_INCOMPLETE_NUMBER","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-container-003", "Deeply nested unclosed",
    r'{"a":{"b":{"c":1', "length",
    "incomplete", "truncated", False,
    {},
    diagnostics=[{"code":"E_INCOMPLETE_NUMBER","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-unstring-001", "Unclosed string value",
    r'{"key":"value never closes', "length",
    "incomplete", "truncated", False,
    {},
    diagnostics=[{"code":"E_UNTERMINATED_STRING","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-unstring-002", "Unclosed string key",
    r'{"key":1,"incomp', "length",
    "incomplete", "truncated", False,
    {"key":1},
    diagnostics=[{"code":"E_UNTERMINATED_STRING","severity":"error","recoverable":False},{"code":"E_STREAM_TRUNCATED","severity":"error","recoverable":False}],
    notes="First field committed (number 1 terminated by comma), second key incomplete"
)

write_fixture(
    "canonical-dupkey-001", "Simple duplicate key",
    r'{"a":1,"b":2,"a":3}', "complete",
    "root_complete", "invalid", False,
    {"a":1,"b":2},
    diagnostics=[{"code":"E_DUPLICATE_KEY","severity":"error","recoverable":False}],
    notes="First 'a' wins, duplicate makes document invalid"
)

write_fixture(
    "canonical-dupkey-002", "Duplicate key in nested object",
    r'{"obj":{"x":1,"x":2}}', "complete",
    "root_complete", "invalid", False,
    {"obj":{"x":1}},
    diagnostics=[{"code":"E_DUPLICATE_KEY","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-trailing-001", "Extra text after valid JSON",
    r'{"a":1}some trailing text', "complete",
    "root_complete", "invalid", False,
    {"a":1},
    diagnostics=[{"code":"E_TRAILING_DATA","severity":"error","recoverable":False}]
)

write_fixture(
    "canonical-trailing-002", "Whitespace after valid JSON",
    r'{"a":1}   \n  ', "complete",
    "root_complete", "valid", True,
    {"a":1},
    diagnostics=[],
    notes="Trailing whitespace is acceptable"
)
