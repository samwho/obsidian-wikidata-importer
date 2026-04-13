import { __awaiter } from "tslib";
import { requestUrl } from "obsidian";
function isString(type) {
    if (!type)
        return false;
    return (type === "http://www.w3.org/2001/XMLSchema#string" ||
        type === "http://www.w3.org/1999/02/22-rdf-syntax-ns#langString");
}
function isInteger(type) {
    if (!type)
        return false;
    return type === "http://www.w3.org/2001/XMLSchema#integer";
}
function isDecimal(type) {
    if (!type)
        return false;
    return type === "http://www.w3.org/2001/XMLSchema#decimal";
}
function isDate(type) {
    if (!type)
        return false;
    return type === "http://www.w3.org/2001/XMLSchema#dateTime";
}
export class Entity {
    constructor(id, label, description) {
        this.id = id;
        this.label = label;
        this.description = description;
    }
    static fromJson(json) {
        return new Entity(json.id, json.label, json.description);
    }
    static fromId(id) {
        return new Entity(id);
    }
    static search(query) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!query || query.length === 0)
                return [];
            const url = "https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=10&search=" +
                encodeURIComponent(query);
            const response = yield requestUrl(url);
            const json = response.json;
            return json.search.map(Entity.fromJson);
        });
    }
    static replaceCharacters(str, searchString, replaceString) {
        let result = str;
        for (let i = 0; i < searchString.length; i++) {
            const searchChar = searchString[i];
            const replaceChar = replaceString[Math.min(i, replaceString.length - 1)];
            result = result.replace(new RegExp('\\' + searchChar, 'g'), replaceChar);
        }
        return result;
    }
    static buildLink(link, label, id) {
        label = Entity.replaceCharacters(label, '\*/:#?<> "', '_');
        link = link
            .replace(/\$\{label\}/g, label)
            .replace(/\$\{id\}/g, id);
        return link;
    }
    // TODO: incorporate https://query.wikidata.org/#SELECT%20%3FwdLabel%20%3Fps_Label%20%3FwdpqLabel%20%3Fpq_Label%20%7B%0A%20%20VALUES%20%28%3Fcompany%29%20%7B%28wd%3AQ5284%29%7D%0A%20%20%0A%20%20%3Fcompany%20%3Fp%20%3Fstatement%20.%0A%20%20%3Fstatement%20%3Fps%20%3Fps_%20.%0A%20%20%0A%20%20%3Fwd%20wikibase%3Aclaim%20%3Fp.%0A%20%20%3Fwd%20wikibase%3AstatementProperty%20%3Fps.%0A%20%20%0A%20%20OPTIONAL%20%7B%0A%20%20%3Fstatement%20%3Fpq%20%3Fpq_%20.%0A%20%20%3Fwdpq%20wikibase%3Aqualifier%20%3Fpq%20.%0A%20%20%7D%0A%20%20%0A%20%20SERVICE%20wikibase%3Alabel%20%7B%20bd%3AserviceParam%20wikibase%3Alanguage%20%22en%22%20%7D%0A%7D%20ORDER%20BY%20%3Fwd%20%3Fstatement%20%3Fps_
    getProperties(opts) {
        return __awaiter(this, void 0, void 0, function* () {
            let query = `
			SELECT ?propertyLabel ?value ?valueLabel ?valueType ?normalizedValue ?description WHERE {
				wd:${this.id} ?propUrl ?value .
				?property wikibase:directClaim ?propUrl .
				OPTIONAL { wd:${this.id} schema:description ?description . FILTER (LANG(?description) = "en") }
				OPTIONAL {
					?statement psn:P31 ?normalizedValue .
					?normalizedValue wikibase:quantityUnit ?unit .
				}
				BIND(DATATYPE(?value) AS ?valueType) .
		`;
            if (opts.ignorePropertiesWithTimeRanges) {
                query += `
				MINUS { ?value p:P580 ?startDateStatement. }
				MINUS { ?value p:P582 ?endDateStatement. }
				MINUS { ?value p:P585 ?pointInTimeStatement. }
			`;
            }
            query += `
				SERVICE wikibase:label {
					bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en" .
				}
			}
		`;
            const url = "https://query.wikidata.org/sparql?query=" +
                encodeURIComponent(query) +
                "&format=json";
            const response = yield requestUrl(url);
            const json = response.json;
            const results = json.results.bindings;
            const ret = {};
            results.forEach((r) => {
                const key = r.propertyLabel.value;
                const value = r.value.value;
                const normalizedValue = r.normalizedValue
                    ? r.normalizedValue.value
                    : null;
                const type = r.valueType ? r.valueType.value : null;
                const valueLabel = r.valueLabel
                    ? r.valueLabel.value
                    : null;
                if (opts.ignoreCategories &&
                    valueLabel &&
                    valueLabel.startsWith("Category:")) {
                    return;
                }
                if (opts.ignoreWikipediaPages &&
                    valueLabel &&
                    valueLabel.startsWith("Wikipedia:")) {
                    return;
                }
                if (opts.ignoreIDs && valueLabel && key.match(/\bID\b/)) {
                    return;
                }
                let toAdd = valueLabel;
                if (normalizedValue) {
                    toAdd = normalizedValue;
                }
                else if (isDate(type)) {
                    toAdd = value;
                }
                else if (isDecimal(type)) {
                    toAdd = parseFloat(value);
                }
                else if (isInteger(type)) {
                    toAdd = parseInt(value);
                }
                else if (isString(type)) {
                    toAdd = value;
                }
                else if (value.match(/Q\d+$/) && valueLabel) {
                    let id = value.match(/\d+$/);
                    console.log("found id: " + label);
                    id = id[0];
                    var label = Entity.buildLink(opts.internalLinkPrefix, valueLabel, id);
                    toAdd
                    toAdd = `[[${label}]]`;
                }
                if (toAdd === null) {
                    return;
                }
                if (ret[key]) {
                    ret[key].push(toAdd);
                }
                else {
                    ret[key] = [toAdd];
                }
            });
            return ret;
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2lraWRhdGEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJ3aWtpZGF0YS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUEsT0FBTyxFQUFFLFVBQVUsRUFBRSxNQUFNLFVBQVUsQ0FBQztBQWtCdEMsU0FBUyxRQUFRLENBQUMsSUFBbUI7SUFDcEMsSUFBSSxDQUFDLElBQUk7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUN4QixPQUFPLENBQ04sSUFBSSxLQUFLLHlDQUF5QztRQUNsRCxJQUFJLEtBQUssdURBQXVELENBQ2hFLENBQUM7QUFDSCxDQUFDO0FBRUQsU0FBUyxTQUFTLENBQUMsSUFBbUI7SUFDckMsSUFBSSxDQUFDLElBQUk7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUN4QixPQUFPLElBQUksS0FBSywwQ0FBMEMsQ0FBQztBQUM1RCxDQUFDO0FBRUQsU0FBUyxTQUFTLENBQUMsSUFBbUI7SUFDckMsSUFBSSxDQUFDLElBQUk7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUN4QixPQUFPLElBQUksS0FBSywwQ0FBMEMsQ0FBQztBQUM1RCxDQUFDO0FBRUQsU0FBUyxNQUFNLENBQUMsSUFBbUI7SUFDbEMsSUFBSSxDQUFDLElBQUk7UUFBRSxPQUFPLEtBQUssQ0FBQztJQUN4QixPQUFPLElBQUksS0FBSywyQ0FBMkMsQ0FBQztBQUM3RCxDQUFDO0FBRUQsTUFBTSxPQUFPLE1BQU07SUFLbEIsWUFBWSxFQUFVLEVBQUUsS0FBYyxFQUFFLFdBQW9CO1FBQzNELElBQUksQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDO1FBQ2IsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLFdBQVcsR0FBRyxXQUFXLENBQUM7SUFDaEMsQ0FBQztJQUVELE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBUztRQUN4QixPQUFPLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLEtBQUssRUFBRSxJQUFJLENBQUMs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LElBQUksUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFO29CQUMxQixLQUFLLEdBQUcsS0FBSyxDQUFDO2lCQUNkO3FCQUFNLElBQUksS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxVQUFVLEVBQUU7b0JBQzlDLElBQUksRUFBRSxHQUFHLEtBQUssQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLENBQUM7b0JBQzdCLE9BQU8sQ0FBQyxHQUFHLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQyxDQUFDO29CQUNsQyxFQUFFLEdBQUcsRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO29CQUNYLElBQUksS0FBSyxHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUMsSUFBSSxDQUFDLGtCQUFrQixFQUFFLFVBQVUsRUFBRSxFQUFFLENBQUMsQ0FBQztvQkFDdEUsS0FBSyxHQUFHLEtBQUssS0FBSyxJQUFJLENBQUM7aUJBQ3ZCO2dCQUVELElBQUksS0FBSyxLQUFLLElBQUksRUFBRTtvQkFDbkIsT0FBTztpQkFDUDtnQkFFRCxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsRUFBRTtvQkFDYixHQUFHLENBQUMsR0FBRyxDQUFDLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDO2lCQUNyQjtxQkFBTTtvQkFDTixHQUFHLENBQUMsR0FBRyxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztpQkFDbkI7WUFDRixDQUFDLENBQUMsQ0FBQztZQUVILE9BQU8sR0FBRyxDQUFDO1FBQ1osQ0FBQztLQUFBO0NBQ0QiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyByZXF1ZXN0VXJsIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmV4cG9ydCB0eXBlIFZhbHVlID0gc3RyaW5nIHwgbnVtYmVyIHwgYm9vbGVhbjtcbmV4cG9ydCB0eXBlIFByb3BlcnRpZXMgPSB7IFtrZXk6IHN0cmluZ106IEFycmF5PFZhbHVlPiB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFNlYXJjaFJlc3BvbnNlIHtcblx0c2VhcmNoOiBFbnRpdHlbXTtcblx0c3VjY2VzczogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdldFByb3BlcnRpZXNPcHRpb25zIHtcblx0aWdub3JlQ2F0ZWdvcmllczogYm9vbGVhbjtcblx0aWdub3JlV2lraXBlZGlhUGFnZXM6IGJvb2xlYW47XG5cdGlnbm9yZUlEczogYm9vbGVhbjtcblx0aWdub3JlUHJvcGVydGllc1dpdGhUaW1lUmFuZ2VzOiBib29sZWFuO1xuXHRpbnRlcm5hbExpbmtQcmVmaXg6IHN0cmluZztcbn1cblxuZnVuY3Rpb24gaXNTdHJpbmcodHlwZTogc3RyaW5nIHwgbnVsbCk6IGJvb2xlYW4ge1xuXHRpZiAoIXR5cGUpIHJldHVybiBmYWxzZTtcblx0cmV0dXJuIChcblx0XHR0eXBlID09PSBcImh0dHA6Ly93d3cudzMub3JnLzIwMDEvWE1MU2NoZW1hI3N0cmluZ1wiIHx8XG5cdFx0dHlwZSA9PT0gXCJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjbGFuZ1N0cmluZ1wiXG5cdCk7XG59XG5cbmZ1bmN0aW9uIGlzSW50ZWdlcih0eXBlOiBzdHJpbmcgfCBudWxsKTogYm9vbGVhbiB7XG5cdGlmICghdHlwZSkgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gdHlwZSA9PT0gXCJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSNpbnRlZ2VyXCI7XG59XG5cbmZ1bmN0aW9uIGlzRGVjaW1hbCh0eXBlOiBzdHJpbmcgfCBudWxsKTogYm9vbGVhbiB7XG5cdGlmICghdHlwZSkgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gdHlwZSA9PT0gXCJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSNkZWNpbWFsXCI7XG59XG5cbmZ1bmN0aW9uIGlzRGF0ZSh0eXBlOiBzdHJpbmcgfCBudWxsKTogYm9vbGVhbiB7XG5cdGlmICghdHlwZSkgcmV0dXJuIGZhbHNlO1xuXHRyZXR1cm4gdHlwZSA9PT0gXCJodHRwOi8vd3d3LnczLm9yZy8yMDAxL1hNTFNjaGVtYSNkYXRlVGltZVwiO1xufVxuXG5leHBvcnQgY2xhc3MgRW50aXR5IHtcblx0aWQ6IHN0cmluZztcblx0bGFiZWw/OiBzdHJpbmc7XG5cdGRlc2NyaXB0aW9uPzogc3RyaW5nO1xuXG5cdGNvbnN0cnVjdG9yKGlkOiBzdHJpbmcsIGxhYmVsPzogc3RyaW5nLCBkZXNjcmlwdGlvbj86IHN0cmluZykge1xuXHRcdHRoaXMuaWQgPSBpZDtcblx0XHR0aGlzLmxhYmVsID0gbGFiZWw7XG5cdFx0dGhpcy5kZXNjcmlwdGlvbiA9IGRlc2NyaXB0aW9uO1xuXHR9XG5cblx0c3RhdGljIGZyb21Kc29uKGpzb246IGFueSk6IEVudGl0eSB7XG5cdFx0cmV0dXJuIG5ldyBFbnRpdHkoanNvbi5pZCwganNvbi5sYWJlbCwganNvbi5kZXNjcmlwdGlvbik7XG5cdH1cblxuXHRzdGF0aWMgZnJvbUlkKGlkOiBzdHJpbmcpOiBFbnRpdHkge1xuXHRcdHJldHVybiBuZXcgRW50aXR5KGlkKTtcblx0fVxuXG5cdHN0YXRpYyBhc3luYyBzZWFyY2gocXVlcnk6IHN0cmluZyk6IFByb21pc2U8RW50aXR5W10+IHtcblx0XHRpZiAoIXF1ZXJ5IHx8IHF1ZXJ5Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuXG5cdFx0Y29uc3QgdXJsID1cblx0XHRcdFwiaHR0cHM6Ly93d3cud2lraWRhdGEub3JnL3cvYXBpLnBocD9hY3Rpb249d2JzZWFyY2hlbnRpdGllcyZmb3JtYXQ9anNvbiZsYW5ndWFnZT1lbiZ0eXBlPWl0ZW0mbGltaXQ9MTAmc2VhcmNoPVwiICtcblx0XHRcdGVuY29kZVVSSUNvbXBvbmVudChxdWVyeSk7XG5cdFx0Y29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0VXJsKHVybCk7XG5cdFx0Y29uc3QganNvbjogU2VhcmNoUmVzcG9uc2UgPSByZXNwb25zZS5qc29uO1xuXHRcdHJldHVybiBqc29uLnNlYXJjaC5tYXAoRW50aXR5LmZyb21Kc29uKTtcblx0fVxuXG5cdHN0YXRpYyByZXBsYWNlQ2hhcmFjdGVycyhzdHIgOiBzdHJpbmcsIHNlYXJjaFN0cmluZyA6IHN0cmluZywgcmVwbGFjZVN0cmluZyA6IHN0cmluZykge1xuXHRcdGxldCByZXN1bHQgPSBzdHI7XG4gICAgXG5cdFx0Zm9yIChsZXQgaSA9IDA7IGkgPCBzZWFyY2hTdHJpbmcubGVuZ3RoOyBpKyspIHtcblx0XHRcdGNvbnN0IHNlYXJjaENoYXIgPSBzZWFyY2hTdHJpbmdbaV07XG5cdFx0XHRjb25zdCByZXBsYWNlQ2hhciA9IHJlcGxhY2VTdHJpbmdbTWF0aC5taW4oaSwgcmVwbGFjZVN0cmluZy5sZW5ndGggLSAxKV07XG4gICAgICAgIFxuXHRcdFx0cmVzdWx0ID0gcmVzdWx0LnJlcGxhY2UobmV3IFJlZ0V4cCgnXFxcXCcgKyBzZWFyY2hDaGFyLCAnZycpLCByZXBsYWNlQ2hhcik7XG5cdFx0fVxuICAgIFxuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cblxuXHRzdGF0aWMgYnVpbGRMaW5rKGxpbmsgOiBzdHJpbmcsIGxhYmVsIDogc3RyaW5nLCBpZCA6IHN0cmluZykgOiBzdHJpbmcge1xuXHRcdGxhYmVsID0gRW50aXR5LnJlcGxhY2VDaGFyYWN0ZXJzKGxhYmVsLCAnXFwqLzojPzw+IFwiJywgJ18nKTtcblxuXHRcdGxpbmsgPSBsaW5rXG5cdFx0XHQucmVwbGFjZSgvXFwkXFx7bGFiZWxcXH0vZywgbGFiZWwpXG5cdFx0XHQucmVwbGFjZSgvXFwkXFx7aWRcXH0vZywgaWQpO1xuXHRcdHJldHVybiBsaW5rO1xuXHR9XG5cblx0Ly8gVE9ETzogaW5jb3Jwb3JhdGUgaHR0cHM6Ly9xdWVyeS53aWtpZGF0YS5vcmcvI1NFTEVDVCUyMCUzRndkTGFiZWwlMjAlM0Zwc19MYWJlbCUyMCUzRndkcHFMYWJlbCUyMCUzRnBxX0xhYmVsJTIwJTdCJTBBJTIwJTIwVkFMVUVTJTIwJTI4JTNGY29tcGFueSUyOSUyMCU3QiUyOHdkJTNBUTUyODQlMjklN0QlMEElMjAlMjAlMEElMjAlMjAlM0Zjb21wYW55JTIwJTNGcCUyMCUzRnN0YXRlbWVudCUyMC4lMEElMjAlMjAlM0ZzdGF0ZW1lbnQlMjAlM0ZwcyUyMCUzRnBzXyUyMC4lMEElMjAlMjAlMEElMjAlMjAlM0Z3ZCUyMHdpa2liYXNlJTNBY2xhaW0lMjAlM0ZwLiUwQSUyMCUyMCUzRndkJTIwd2lraWJhc2UlM0FzdGF0ZW1lbnRQcm9wZXJ0eSUyMCUzRnBzLiUwQSUyMCUyMCUwQSUyMCUyME9QVElPTkFMJTIwJTdCJTBBJTIwJTIwJTNGc3RhdGVtZW50JTIwJTNGcHElMjAlM0ZwcV8lMjAuJTBBJTIwJTIwJTNGd2RwcSUyMHdpa2liYXNlJTNBcXVhbGlmaWVyJTIwJTNGcHElMjAuJTBBJTIwJTIwJTdEJTBBJTIwJTIwJTBBJTIwJTIwU0VSVklDRSUyMHdpa2liYXNlJTNBbGFiZWwlMjAlN0IlMjBiZCUzQXNlcnZpY2VQYXJhbSUyMHdpa2liYXNlJTNBbGFuZ3VhZ2UlMjAlMjJlbiUyMiUyMCU3RCUwQSU3RCUyME9SREVSJTIwQlklMjAlM0Z3ZCUyMCUzRnN0YXRlbWVudCUyMCUzRnBzX1xuXHRhc3luYyBnZXRQcm9wZXJ0aWVzKG9wdHM6IEdldFByb3BlcnRpZXNPcHRpb25zKTogUHJvbWlzZTxQcm9wZXJ0aWVzPiB7XG5cdFx0bGV0IHF1ZXJ5ID0gYFxuXHRcdFx0U0VMRUNUID9wcm9wZXJ0eUxhYmVsID92YWx1ZSA/dmFsdWVMYWJlbCA/dmFsdWVUeXBlID9ub3JtYWxpemVkVmFsdWUgP2Rlc2NyaXB0aW9uIFdIRVJFIHtcblx0XHRcdFx0d2Q6JHt0aGlzLmlkfSA/cHJvcFVybCA/dmFsdWUgLlxuXHRcdFx0XHQ/cHJvcGVydHkgd2lraWJhc2U6ZGlyZWN0Q2xhaW0gP3Byb3BVcmwgLlxuXHRcdFx0XHRPUFRJT05BTCB7IHdkOiR7dGhpcy5pZH0gc2NoZW1hOmRlc2NyaXB0aW9uID9kZXNjcmlwdGlvbiAuIEZJTFRFUiAoTEFORyg/ZGVzY3JpcHRpb24pID0gXCJlblwiKSB9XG5cdFx0XHRcdE9QVElPTkFMIHtcblx0XHRcdFx0XHQ/c3RhdGVtZW50IHBzbjpQMzEgP25vcm1hbGl6ZWRWYWx1ZSAuXG5cdFx0XHRcdFx0P25vcm1hbGl6ZWRWYWx1ZSB3aWtpYmFzZTpxdWFudGl0eVVuaXQgP3VuaXQgLlxuXHRcdFx0XHR9XG5cdFx0XHRcdEJJTkQoREFUQVRZUEUoP3ZhbHVlKSBBUyA/dmFsdWVUeXBlKSAuXG5cdFx0YDtcblxuXHRcdGlmIChvcHRzLmlnbm9yZVByb3BlcnRpZXNXaXRoVGltZVJhbmdlcykge1xuXHRcdFx0cXVlcnkgKz0gYFxuXHRcdFx0XHRNSU5VUyB7ID92YWx1ZSBwOlA1ODAgP3N0YXJ0RGF0ZVN0YXRlbWVudC4gfVxuXHRcdFx0XHRNSU5VUyB7ID92YWx1ZSBwOlA1ODIgP2VuZERhdGVTdGF0ZW1lbnQuIH1cblx0XHRcdFx0TUlOVVMgeyA/dmFsdWUgcDpQNTg1ID9wb2ludEluVGltZVN0YXRlbWVudC4gfVxuXHRcdFx0YDtcblx0XHR9XG5cblx0XHRxdWVyeSArPSBgXG5cdFx0XHRcdFNFUlZJQ0Ugd2lraWJhc2U6bGFiZWwge1xuXHRcdFx0XHRcdGJkOnNlcnZpY2VQYXJhbSB3aWtpYmFzZTpsYW5ndWFnZSBcIltBVVRPX0xBTkdVQUdFXSxlblwiIC5cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdGA7XG5cblx0XHRjb25zdCB1cmwgPVxuXHRcdFx0XCJodHRwczovL3F1ZXJ5Lndpa2lkYXRhLm9yZy9zcGFycWw/cXVlcnk9XCIgK1xuXHRcdFx0ZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5KSArXG5cdFx0XHRcIiZmb3JtYXQ9anNvblwiO1xuXG5cdFx0Y29uc3QgcmVzcG9uc2UgPSBhd2FpdCByZXF1ZXN0VXJsKHVybCk7XG5cdFx0Y29uc3QganNvbiA9IHJlc3BvbnNlLmpzb247XG5cdFx0Y29uc3QgcmVzdWx0cyA9IGpzb24ucmVzdWx0cy5iaW5kaW5ncztcblxuXHRcdGNvbnN0IHJldDogUHJvcGVydGllcyA9IHt9O1xuXG5cdFx0cmVzdWx0cy5mb3JFYWNoKChyOiBhbnkpID0+IHtcblx0XHRcdGNvbnN0IGtleTogc3RyaW5nID0gci5wcm9wZXJ0eUxhYmVsLnZhbHVlO1xuXHRcdFx0Y29uc3QgdmFsdWU6IHN0cmluZyA9IHIudmFsdWUudmFsdWU7XG5cdFx0XHRjb25zdCBub3JtYWxpemVkVmFsdWU6IHN0cmluZyB8IG51bGwgPSByLm5vcm1hbGl6ZWRWYWx1ZVxuXHRcdFx0XHQ/IHIubm9ybWFsaXplZFZhbHVlLnZhbHVlXG5cdFx0XHRcdDogbnVsbDtcblx0XHRcdGNvbnN0IHR5cGU6IHN0cmluZyB8IG51bGwgPSByLnZhbHVlVHlwZSA/IHIudmFsdWVUeXBlLnZhbHVlIDogbnVsbDtcblx0XHRcdGNvbnN0IHZhbHVlTGFiZWw6IHN0cmluZyB8IG51bGwgPSByLnZhbHVlTGFiZWxcblx0XHRcdFx0PyByLnZhbHVlTGFiZWwudmFsdWVcblx0XHRcdFx0OiBudWxsO1xuXG5cdFx0XHRpZiAoXG5cdFx0XHRcdG9wdHMuaWdub3JlQ2F0ZWdvcmllcyAmJlxuXHRcdFx0XHR2YWx1ZUxhYmVsICYmXG5cdFx0XHRcdHZhbHVlTGFiZWwuc3RhcnRzV2l0aChcIkNhdGVnb3J5OlwiKVxuXHRcdFx0KSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0aWYgKFxuXHRcdFx0XHRvcHRzLmlnbm9yZVdpa2lwZWRpYVBhZ2VzICYmXG5cdFx0XHRcdHZhbHVlTGFiZWwgJiZcblx0XHRcdFx0dmFsdWVMYWJlbC5zdGFydHNXaXRoKFwiV2lraXBlZGlhOlwiKVxuXHRcdFx0KSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0aWYgKG9wdHMuaWdub3JlSURzICYmIHZhbHVlTGFiZWwgJiYga2V5Lm1hdGNoKC9cXGJJRFxcYi8pKSB7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0bGV0IHRvQWRkOiBWYWx1ZSB8IG51bGwgPSB2YWx1ZUxhYmVsO1xuXG5cdFx0XHRpZiAobm9ybWFsaXplZFZhbHVlKSB7XG5cdFx0XHRcdHRvQWRkID0gbm9ybWFsaXplZFZhbHVlO1xuXHRcdFx0fSBlbHNlIGlmIChpc0RhdGUodHlwZSkpIHtcblx0XHRcdFx0dG9BZGQgPSB2YWx1ZTtcblx0XHRcdH0gZWxzZSBpZiAoaXNEZWNpbWFsKHR5cGUpKSB7XG5cdFx0XHRcdHRvQWRkID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG5cdFx0XHR9IGVsc2UgaWYgKGlzSW50ZWdlcih0eXBlKSkge1xuXHRcdFx0XHR0b0FkZCA9IHBhcnNlSW50KHZhbHVlKTtcblx0XHRcdH0gZWxzZSBpZiAoaXNTdHJpbmcodHlwZSkpIHtcblx0XHRcdFx0dG9BZGQgPSB2YWx1ZTtcblx0XHRcdH0gZWxzZSBpZiAodmFsdWUubWF0Y2goL1FcXGQrJC8pICYmIHZhbHVlTGFiZWwpIHtcblx0XHRcdFx0bGV0IGlkID0gdmFsdWUubWF0Y2goL1xcZCskLyk7XG5cdFx0XHRcdGNvbnNvbGUubG9nKFwiZm91bmQgaWQ6IFwiICsgbGFiZWwpO1xuXHRcdFx0XHRpZCA9IGlkWzBdO1xuXHRcdFx0XHR2YXIgbGFiZWwgPSBFbnRpdHkuYnVpbGRMaW5rKG9wdHMuaW50ZXJuYWxMaW5rUHJlZml4LCB2YWx1ZUxhYmVsLCBpZCk7XG5cdFx0XHRcdHRvQWRkID0gYFtbJHtsYWJlbH1dXWA7XG5cdFx0XHR9XG5cblx0XHRcdGlmICh0b0FkZCA9PT0gbnVsbCkge1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGlmIChyZXRba2V5XSkge1xuXHRcdFx0XHRyZXRba2V5XS5wdXNoKHRvQWRkKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHJldFtrZXldID0gW3RvQWRkXTtcblx0XHRcdH1cblx0XHR9KTtcblxuXHRcdHJldHVybiByZXQ7XG5cdH1cbn1cbiJdfQ==