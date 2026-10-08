// The HTML body is served under `sandbox allow-scripts` without allow-same-origin, so the document
// has an opaque origin and reading window.localStorage / sessionStorage throws. The shim installs an
// in-memory Storage only where the getter throws; it never throws itself.
const STORAGE_SOURCE =
	'(function(){try{function m(){var d=new Map();return Object.create(typeof Storage==="function"?Storage.prototype:Object.prototype,{length:{get:function(){return d.size}},key:{value:function(i){var k=Array.from(d.keys())[i];return k===undefined?null:k}},getItem:{value:function(k){k=String(k);return d.has(k)?d.get(k):null}},setItem:{value:function(k,v){d.set(String(k),String(v))}},removeItem:{value:function(k){d.delete(String(k))}},clear:{value:function(){d.clear()}}})}["localStorage","sessionStorage"].forEach(function(n){try{window[n]}catch(e){Object.defineProperty(window,n,{value:m(),configurable:true})}})}catch(e){}})()'

// Following a link in the frame replaces the Artifact with a page that usually refuses to be framed, and
// the sandbox allows no popup, so a click on an http(s) link to another origin is handed to the embedding
// page, which opens it in a new tab. Links within the document keep browser behaviour; any other link on
// this origin is cancelled because an Artifact is one file and every other path is not found, and its
// fragment, if any, is applied to the current document. Bubble phase, so the page's own handlers run first
// and can cancel. The frame's own origin is read from location.href because location.origin is "null"
// under the sandbox. It never throws.
const LINK_SOURCE = [
	"(function(){try{",
	"if(window.parent===window)return;",
	"var h=function(e){try{",
	"if(e.defaultPrevented)return;",
	'if(e.type==="click"?e.button!==0:e.button!==1)return;',
	"var p=e.composedPath(),a=null,r=null,i,n;",
	"for(i=0;i<p.length;i++){n=p[i];",
	'if(!n||(n.localName!=="a"&&n.localName!=="area")||typeof n.getAttribute!=="function")continue;',
	'r=n.getAttribute("href");if(r===null)r=n.getAttribute("xlink:href");',
	"if(r!==null){a=n;break}}",
	"if(a===null)return;",
	'if(a.hasAttribute("download"))return;',
	'var t=a.getAttribute("target");',
	'if(t!==null&&["","_self","_blank","_top","_parent"].indexOf(t.toLowerCase())===-1)return;',
	"var u=new URL(r,document.baseURI);",
	'if(u.protocol!=="http:"&&u.protocol!=="https:")return;',
	// location.origin is "null" in the opaque-origin frame; the URL still names the usercontent origin.
	"var c=new URL(location.href);",
	"if(u.origin===c.origin){",
	"if(u.pathname===c.pathname&&u.search===c.search)return;",
	"e.preventDefault();",
	'if(e.type==="click"&&u.hash)location.href=new URL(u.hash,c.href).href;',
	"return}",
	"e.preventDefault();",
	'window.parent.postMessage({type:"exagram:open-link",url:u.href},"*")',
	"}catch(x){}};",
	'window.addEventListener("click",h);window.addEventListener("auxclick",h)',
	"}catch(e){}})()",
].join("")

const SHIM = Buffer.from(`<script>${STORAGE_SOURCE};${LINK_SOURCE}</script>`, "latin1")

// A doctype fits well within this prefix; the rest of the body is never decoded.
const PREFIX_BYTES = 1024

// Inserted after a leading doctype, else at the start (after a BOM). Per the HTML parsing spec a <script>
// before <html> makes the parser create html/head implicitly and put the script in head; the page's own
// <html> attributes then merge onto that root and its <head> tag is ignored. The doctype stays first so
// the document keeps standards mode.
const insertionOffset = (bytes: Uint8Array): number => {
	// latin1 keeps one char per byte, so offsets in the prefix are byte offsets.
	const prefix = Buffer.from(bytes.subarray(0, PREFIX_BYTES)).toString("latin1")
	const bom = prefix.startsWith("\u00ef\u00bb\u00bf") ? 3 : 0
	const match = /^[\t\n\f\r ]*<!doctype/i.exec(prefix.slice(bom))
	if (!match) return bom
	const close = prefix.indexOf(">", bom + match[0].length)
	return close === -1 ? bom : close + 1
}

export const injectInlineShims = (bytes: Uint8Array): Buffer => {
	const j = insertionOffset(bytes)
	return Buffer.concat([bytes.subarray(0, j), SHIM, bytes.subarray(j)])
}
