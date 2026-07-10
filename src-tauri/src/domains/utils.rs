pub fn xml_escape(input: &str) -> String {
    let mut escaped = String::with_capacity(input.len());
    for c in input.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            _ => escaped.push(c),
        }
    }
    escaped
}

// Helper functions for reading values out of domain XML
pub fn get_tag_content(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}", tag);
    let end_tag = format!("</{}>", tag);
    let start_idx = xml.find(&start_tag)?;
    let tag_end_idx = xml[start_idx..].find('>')?;
    let val_start = start_idx + tag_end_idx + 1;
    let end_idx = xml[val_start..].find(&end_tag)?;
    Some(xml[val_start..val_start + end_idx].trim().to_string())
}

pub fn get_attr_in_block(block: &str, tag_prefix: &str, attr: &str) -> Option<String> {
    let tag_idx = block.find(tag_prefix)?;
    let after_tag = &block[tag_idx..];
    let tag_close = after_tag.find('>').unwrap_or(after_tag.len());
    let tag_slice = &after_tag[..tag_close];
    for quote in ['\'', '"'] {
        let search = format!("{}={}", attr, quote);
        if let Some(attr_idx) = tag_slice.find(&search) {
            let start = attr_idx + search.len();
            if let Some(end_idx) = tag_slice[start..].find(quote) {
                return Some(tag_slice[start..start + end_idx].to_string());
            }
        }
    }
    None
}

// Collect every <open ... </close> block in document order
pub fn collect_blocks(xml: &str, open: &str, close: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut rest = xml;
    while let Some(start) = rest.find(open) {
        let after = &rest[start..];
        match after.find(close) {
            Some(rel_end) => {
                let end = rel_end + close.len();
                blocks.push(after[..end].to_string());
                rest = &after[end..];
            }
            None => break,
        }
    }
    blocks
}

// Rewrite every <open ... </close> block via the provided transform, preserving the rest
pub fn map_blocks(xml: &str, open: &str, close: &str, f: impl Fn(&str) -> String) -> String {
    let mut result = String::new();
    let mut rest = xml;
    while let Some(start) = rest.find(open) {
        result.push_str(&rest[..start]);
        let after = &rest[start..];
        match after.find(close) {
            Some(rel_end) => {
                let end = rel_end + close.len();
                result.push_str(&f(&after[..end]));
                rest = &after[end..];
            }
            None => {
                result.push_str(after);
                return result;
            }
        }
    }
    result.push_str(rest);
    result
}

// Helper functions for XML replacement
pub fn replace_tag_content(xml: &str, tag: &str, new_value: &str) -> String {
    let start_tag = format!("<{}", tag);
    let end_tag = format!("</{}>", tag);
    
    if let Some(start_idx) = xml.find(&start_tag) {
        if let Some(tag_end_idx) = xml[start_idx..].find('>') {
            let val_start = start_idx + tag_end_idx + 1;
            if let Some(end_idx) = xml[val_start..].find(&end_tag) {
                let val_end = val_start + end_idx;
                let mut new_xml = String::new();
                new_xml.push_str(&xml[..val_start]);
                new_xml.push_str(new_value);
                new_xml.push_str(&xml[val_end..]);
                return new_xml;
            }
        }
    }
    xml.to_string()
}

pub fn replace_attr_in_block(block: &str, tag_prefix: &str, attr: &str, new_val: &str) -> String {
    if let Some(tag_idx) = block.find(tag_prefix) {
        let after_tag = &block[tag_idx..];
        let search_single = format!("{}='", attr);
        let search_double = format!("{}=\"", attr);
        
        if let Some(attr_idx) = after_tag.find(&search_single) {
            let start = tag_idx + attr_idx + search_single.len();
            if let Some(end_idx) = block[start..].find('\'') {
                let mut new_block = String::new();
                new_block.push_str(&block[..start]);
                new_block.push_str(new_val);
                new_block.push_str(&block[start + end_idx..]);
                return new_block;
            }
        } else if let Some(attr_idx) = after_tag.find(&search_double) {
            let start = tag_idx + attr_idx + search_double.len();
            if let Some(end_idx) = block[start..].find('"') {
                let mut new_block = String::new();
                new_block.push_str(&block[..start]);
                new_block.push_str(new_val);
                new_block.push_str(&block[start + end_idx..]);
                return new_block;
            }
        }
    }
    block.to_string()
}

// Removes every <tag ...> element (self-closing or paired) whose opening tag
// contains `marker`, together with the leading indentation of its line.
pub fn remove_elements_containing(xml: &str, tag: &str, marker: &str) -> String {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let mut out = xml.to_string();
    let mut search_from = 0;
    while let Some(rel) = out[search_from..].find(&open) {
        let start = search_from + rel;
        let Some(tag_end_rel) = out[start..].find('>') else { break };
        let tag_end = start + tag_end_rel;
        let open_tag = &out[start..=tag_end];
        let elem_end = if open_tag.ends_with("/>") {
            tag_end + 1
        } else {
            match out[tag_end..].find(&close) {
                Some(r) => tag_end + r + close.len(),
                None => break,
            }
        };
        if out[start..tag_end].contains(marker) {
            let line_start = match out[..start].rfind('\n') {
                Some(i) if out[i + 1..start].trim().is_empty() => i,
                _ => start,
            };
            out.replace_range(line_start..elem_end, "");
            search_from = line_start;
        } else {
            search_from = tag_end + 1;
        }
    }
    out
}

pub fn remove_attr_from_tag(block: &str, tag_prefix: &str, attr: &str) -> String {
    if let Some(tag_idx) = block.find(tag_prefix) {
        if let Some(rel_end) = block[tag_idx..].find('>') {
            let tag_end = tag_idx + rel_end + 1;
            let mut tag = block[tag_idx..tag_end].to_string();
            for pat in [format!(" {}='", attr), format!(" {}=\"", attr)] {
                if let Some(attr_idx) = tag.find(&pat) {
                    let quote_char = pat.chars().last().unwrap();
                    let val_start = attr_idx + pat.len();
                    if let Some(end_rel) = tag[val_start..].find(quote_char) {
                        let val_end = val_start + end_rel + 1;
                        tag.replace_range(attr_idx..val_end, "");
                    }
                    break;
                }
            }
            let mut result = String::new();
            result.push_str(&block[..tag_idx]);
            result.push_str(&tag);
            result.push_str(&block[tag_end..]);
            return result;
        }
    }
    block.to_string()
}

pub fn insert_before_devices_close(xml: &mut String, snippet: &str) {
    if let Some(idx) = xml.find("</devices>") {
        xml.insert_str(idx, snippet);
    }
}

pub fn extract_xml_tag_content(xml: &str, tag: &str) -> Option<String> {
    let start_tag = format!("<{}>", tag);
    let end_tag = format!("</{}>", tag);
    if let Some(start_idx) = xml.find(&start_tag) {
        let content_start = start_idx + start_tag.len();
        if let Some(end_idx) = xml[content_start..].find(&end_tag) {
            return Some(xml[content_start..content_start + end_idx].to_string());
        }
    }
    None
}
