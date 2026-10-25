// QML-compatible pure helpers. No files, processes or desktop actions.
function parseBlocks(text) {
  var result = {};
  if (typeof text !== "string" || text.length > 65536) return result;
  text.split("\n").forEach(function(line) {
    var fields = line.split("\t");
    if (fields.length < 3 || !/^(0|[1-9][0-9]{0,4})$/.test(fields[0])
        || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(fields[1])) return;
    var block = Number(fields[0]);
    if (block <= 10000 && Object.keys(result).length < 32) result[fields[1]] = block;
  });
  return result;
}
